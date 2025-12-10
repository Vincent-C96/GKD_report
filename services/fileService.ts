import { FileType, GradingResult, InstructorSettings } from '../types';

// Keywords to identify target locations in the document
const SCORE_KEYWORDS = ['评分', '得分', '分数', 'Score', 'Grade', 'Points', 'Mark'];
const COMMENT_KEYWORDS = ['评语', '老师评语', '教师评语', 'Comments', 'Feedback', 'Teacher Comments', 'Remarks'];
const INSTRUCTOR_KEYWORDS = ['指导教师', '教师签名', '签名', 'Instructor', 'Teacher', 'Signature', 'Signed by'];

export const extractTextFromFile = async (file: File): Promise<string> => {
  const fileType = file.type || getMimeTypeFromExtension(file.name);

  try {
    if (fileType === FileType.WORD) {
      return await parseWord(file);
    } else if (fileType === FileType.EXCEL) {
      return await parseExcel(file);
    } else if (fileType === FileType.PDF) {
      return await parsePdf(file);
    } else {
      // Fallback based on extension if type is missing (common in extracted files)
      if (file.name.endsWith('.docx')) return await parseWord(file);
      if (file.name.endsWith('.xlsx')) return await parseExcel(file);
      if (file.name.endsWith('.pdf')) return await parsePdf(file);
      
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    console.error("Error extracting text:", error);
    // Ensure we throw a proper Error object with a message
    throw new Error(error instanceof Error ? error.message : "Failed to read file content");
  }
};

const parseWord = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result;
      if (!window.mammoth) {
        reject(new Error("Mammoth library not loaded"));
        return;
      }
      window.mammoth.extractRawText({ arrayBuffer: arrayBuffer })
        .then((result: any) => resolve(result.value))
        .catch((err: any) => reject(new Error(err.message || "Mammoth extraction failed")));
    };
    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsArrayBuffer(file);
  });
};

const parseExcel = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      if (!window.XLSX) {
        reject(new Error("XLSX library not loaded"));
        return;
      }
      try {
        const workbook = window.XLSX.read(data, { type: 'array' });
        let text = "";
        workbook.SheetNames.forEach((sheetName: string) => {
            const worksheet = workbook.Sheets[sheetName];
            text += window.XLSX.utils.sheet_to_txt(worksheet) + "\n";
        });
        resolve(text);
      } catch (err) {
        reject(new Error("Excel parsing failed"));
      }
    };
    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsArrayBuffer(file);
  });
};

const parsePdf = async (file: File): Promise<string> => {
  if (!window.pdfjsLib) throw new Error("PDF.js not loaded");
  
  try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      let fullText = "";
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        fullText += pageText + "\n";
      }
      
      return fullText;
  } catch (err) {
      throw new Error("PDF parsing failed: " + (err instanceof Error ? err.message : String(err)));
  }
};

// --- Zip Extraction ---

export const extractFilesFromZip = async (zipFile: File): Promise<File[]> => {
  if (!window.JSZip) throw new Error("JSZip not loaded");
  
  // Use the constructor approach which is safer for CDN builds
  const zip = new window.JSZip();
  let contents;
  try {
    contents = await zip.loadAsync(zipFile);
  } catch (e) {
    throw new Error("Invalid or corrupted zip file");
  }
  
  const files: File[] = [];
  const entries = Object.keys(contents.files).map(name => contents.files[name]);

  for (const entry of entries) {
    if (entry.dir) continue;
    
    // Check extension
    const name = entry.name;
    const lowerName = name.toLowerCase();
    
    // Ignore MACOSX artifacts and hidden files
    if (lowerName.includes('__macosx') || lowerName.startsWith('.')) continue;

    let type: string | null = null;
    if (lowerName.endsWith('.docx')) type = FileType.WORD;
    else if (lowerName.endsWith('.xlsx')) type = FileType.EXCEL;
    else if (lowerName.endsWith('.pdf')) type = FileType.PDF;

    if (!type) continue;

    try {
        // Extract blob
        const blob = await entry.async('blob');
        // Extract basename for cleaner UI
        const cleanName = name.split('/').pop() || name;
        
        // Create a new File object
        const file = new File([blob], cleanName, { type: type });
        files.push(file);
    } catch (e) {
        console.warn(`Failed to extract entry ${name}:`, e);
    }
  }
  return files;
};

// --- Annotation & Blob Generation Logic ---

// Returns a Blob of the annotated file
export const getAnnotatedFileBlob = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<{ blob: Blob, extension: string }> => {
  const fileType = file.type || getMimeTypeFromExtension(file.name);
  let blob: Blob | null = null;
  let extension = '';

  try {
    if (fileType === FileType.WORD) {
      blob = await annotateWord(file, result, instructor);
      extension = 'docx';
    } else if (fileType === FileType.EXCEL) {
      blob = await annotateExcel(file, result, instructor);
      extension = 'xlsx';
    } else if (fileType === FileType.PDF) {
      blob = await annotatePdf(file, result, instructor);
      extension = 'pdf';
    } else {
        // Double check extension if MIME type was lost (e.g. from zip extraction in some browsers)
        if (file.name.endsWith('.docx')) {
            blob = await annotateWord(file, result, instructor);
            extension = 'docx';
        } else if (file.name.endsWith('.xlsx')) {
            blob = await annotateExcel(file, result, instructor);
            extension = 'xlsx';
        } else if (file.name.endsWith('.pdf')) {
            blob = await annotatePdf(file, result, instructor);
            extension = 'pdf';
        } else {
            throw new Error("Unsupported file type for annotation");
        }
    }

    return { blob, extension };
  } catch (e) {
    console.error("Failed to annotate file, falling back to PDF report:", e);
    // Fallback: Generate generic PDF
    blob = generateReportPDFBlob(file.name, result, instructor);
    return { blob, extension: 'pdf' };
  }
};

const getMimeTypeFromExtension = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.docx')) return FileType.WORD;
    if (lower.endsWith('.xlsx')) return FileType.EXCEL;
    if (lower.endsWith('.pdf')) return FileType.PDF;
    return FileType.UNKNOWN;
}

// Original function wrapper for single download
export const annotateAndDownloadFile = async (file: File, result: GradingResult, instructor?: InstructorSettings) => {
    const { blob, extension } = await getAnnotatedFileBlob(file, result, instructor);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Graded_${file.name.split('.')[0]}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Batch Download as Zip
export const downloadBatchAsZip = async (items: { file: File, result: GradingResult }[], instructor?: InstructorSettings) => {
    if (!window.JSZip) throw new Error("JSZip not loaded");
    const zip = new window.JSZip();
    const folder = zip.folder("Graded_Assignments");

    for (const item of items) {
        try {
            const { blob, extension } = await getAnnotatedFileBlob(item.file, item.result, instructor);
            const fileName = `Graded_${item.file.name.split('.')[0]}.${extension}`;
            folder.file(fileName, blob);
        } catch (e) {
            console.error(`Failed to add ${item.file.name} to zip`, e);
        }
    }

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = "Graded_Batch_Results.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const annotateWord = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<Blob> => {
  if (!window.JSZip) throw new Error("JSZip not loaded");
  
  const arrayBuffer = await file.arrayBuffer();
  const zip = new window.JSZip();
  await zip.loadAsync(arrayBuffer);
  
  const docXml = await zip.file("word/document.xml")?.async("string");
  
  if (!docXml) throw new Error("Invalid Docx");

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, "application/xml");
  
  const cells = xmlDoc.getElementsByTagName("w:tc");
  const paragraphs = xmlDoc.getElementsByTagName("w:p");
  
  const modifiedNodes = new Set(); 

  // Check Table Cells
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const textContent = cell.textContent || "";
    
    // Score
    if (SCORE_KEYWORDS.some(k => textContent.includes(k))) {
      const nextCell = cell.nextElementSibling;
      if (nextCell && !modifiedNodes.has(nextCell)) {
        updateWordParagraph(xmlDoc, nextCell, `${result.score} / 100`, "FF0000"); 
        modifiedNodes.add(nextCell);
      }
    }

    // Comments
    if (COMMENT_KEYWORDS.some(k => textContent.includes(k))) {
        const nextCell = cell.nextElementSibling;
        if (nextCell && !modifiedNodes.has(nextCell)) {
          updateWordParagraph(xmlDoc, nextCell, result.teacher_comment, "FF0000");
          modifiedNodes.add(nextCell);
        } 
    }

    // Instructor Signature
    if (instructor && INSTRUCTOR_KEYWORDS.some(k => textContent.includes(k))) {
        const nextCell = cell.nextElementSibling;
        if (nextCell && !modifiedNodes.has(nextCell)) {
             // Word supports text insertion easily. Image insertion is complex via simple XML.
             // We fallback to text name even if image mode is selected to avoid corruption.
             const signText = instructor.name || "AI Grader";
             updateWordParagraph(xmlDoc, nextCell, signText, "000000");
             modifiedNodes.add(nextCell);
        }
    }
  }

  // Also check generic paragraphs if no tables found or missed
  for(let i=0; i<paragraphs.length; i++) {
      const p = paragraphs[i];
      const text = p.textContent || "";
      if (SCORE_KEYWORDS.some(k => text === k || text.includes(k + ":"))) {
          const nextP = p.nextElementSibling;
          if(nextP && nextP.tagName === 'w:p' && !modifiedNodes.has(nextP)) {
               if (nextP.textContent && nextP.textContent.length < 20) {
                   updateWordParagraph(xmlDoc, nextP, `${result.score}/100`, "FF0000");
                   modifiedNodes.add(nextP);
               }
          }
      }
  }

  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(xmlDoc);
  zip.file("word/document.xml", newXml);
  
  return await zip.generateAsync({ type: "blob", mimeType: FileType.WORD });
};

// Helper to update a Word paragraph while PRESERVING its properties (formatting)
const updateWordParagraph = (doc: Document, parent: Element, text: string, colorHex: string) => {
    // 1. Find the paragraph element
    let p = parent.getElementsByTagName("w:p")[0];
    
    // If no paragraph exists in the element (e.g. empty cell), create one
    if (!p) {
        p = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:p");
        parent.appendChild(p);
    }

    // 2. Extract existing Paragraph Properties (pPr) to preserve alignment/style
    const pPr = p.getElementsByTagName("w:pPr")[0];
    
    // 3. Clear all children of the paragraph
    while (p.firstChild) {
        p.removeChild(p.firstChild);
    }

    // 4. Restore pPr if it existed
    if (pPr) {
        p.appendChild(pPr);
    }

    // 5. Create the new Text Run
    const r = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:r");
    const rPr = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:rPr");
    
    // Apply color
    const color = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:color");
    color.setAttribute("w:val", colorHex);
    rPr.appendChild(color);

    // Support for Asian characters text node
    const t = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:t");
    t.textContent = text;

    r.appendChild(rPr);
    r.appendChild(t);
    p.appendChild(r);
};

const annotateExcel = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<Blob> => {
    if (!window.XLSX) throw new Error("XLSX not loaded");

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = e.target?.result;
            const workbook = window.XLSX.read(data, { type: 'array' });
            
            workbook.SheetNames.forEach((sheetName: string) => {
                const sheet = workbook.Sheets[sheetName];
                const range = window.XLSX.utils.decode_range(sheet['!ref'] || "A1:Z100");
                
                for (let R = range.s.r; R <= range.e.r; ++R) {
                    for (let C = range.s.c; C <= range.e.c; ++C) {
                        const cellAddress = window.XLSX.utils.encode_cell({r: R, c: C});
                        const cell = sheet[cellAddress];
                        
                        if (cell && cell.v) {
                            const val = String(cell.v);
                            
                            // Helper to write text to cell
                            const writeToNextCell = (text: string) => {
                                const targetAddress = window.XLSX.utils.encode_cell({r: R, c: C + 1});
                                const targetCell = sheet[targetAddress] || { t: 's', v: '' };
                                targetCell.v = text;
                                targetCell.t = 's';
                                sheet[targetAddress] = targetCell;
                            };

                            if (SCORE_KEYWORDS.some(k => val.includes(k))) {
                                writeToNextCell(`${result.score}/100`);
                            }

                            if (COMMENT_KEYWORDS.some(k => val.includes(k))) {
                                writeToNextCell(result.teacher_comment);
                            }

                            if (instructor && INSTRUCTOR_KEYWORDS.some(k => val.includes(k))) {
                                writeToNextCell(instructor.name || "AI Grader");
                            }
                        }
                    }
                }
            });

            const wbout = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            resolve(new Blob([wbout], { type: FileType.EXCEL }));
        };
        reader.onerror = () => reject(new Error("File reading failed"));
        reader.readAsArrayBuffer(file);
    });
};

const annotatePdf = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<Blob> => {
    if (!window.pdfjsLib || !window.PDFLib) throw new Error("PDF libraries not loaded");

    const arrayBuffer = await file.arrayBuffer();
    const locations: { page: number, x: number, y: number, type: 'score' | 'comment' | 'instructor' }[] = [];
    
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    const pdf = await loadingTask.promise;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        textContent.items.forEach((item: any) => {
            const str = item.str;
            const transform = item.transform;
            const x = transform[4];
            const y = transform[5];
            
            if (SCORE_KEYWORDS.some(k => str.includes(k))) {
                locations.push({ page: i - 1, x, y, type: 'score' });
            }
            else if (COMMENT_KEYWORDS.some(k => str.includes(k))) {
                locations.push({ page: i - 1, x, y, type: 'comment' });
            }
            else if (instructor && INSTRUCTOR_KEYWORDS.some(k => str.includes(k))) {
                locations.push({ page: i - 1, x, y, type: 'instructor' });
            }
        });
    }

    const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    const { rgb } = window.PDFLib;
    
    const font = await pdfDoc.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
    
    // Embed signature image if available
    let signatureImage = null;
    if (instructor && instructor.mode === 'image' && instructor.imageData) {
        try {
            // Determine type from data URL
            if (instructor.imageData.startsWith('data:image/png')) {
                signatureImage = await pdfDoc.embedPng(instructor.imageData);
            } else if (instructor.imageData.startsWith('data:image/jpeg') || instructor.imageData.startsWith('data:image/jpg')) {
                signatureImage = await pdfDoc.embedJpg(instructor.imageData);
            }
        } catch (e) {
            console.warn("Failed to embed signature image", e);
        }
    }

    for (const loc of locations) {
        const page = pages[loc.page];
        
        if (loc.type === 'score') {
             page.drawRectangle({
                x: loc.x + 45,
                y: loc.y - 5,
                width: 60,
                height: 25,
                color: rgb(1, 1, 1),
                opacity: 1,
            });
             page.drawText(`${result.score}`, { x: loc.x + 50, y: loc.y, size: 14, color: rgb(1, 0, 0), font });
        } 
        else if (loc.type === 'comment') {
            const boxWidth = 350;
            const boxHeight = 100;
            page.drawRectangle({
                x: loc.x + 75,
                y: loc.y - boxHeight + 15,
                width: boxWidth,
                height: boxHeight,
                color: rgb(1, 1, 1),
                opacity: 1,
            });

            // Very primitive wrapping
            const words = result.teacher_comment.split(''); 
            let line = '';
            let yOffset = 0;
            for(const w of words) {
                if (line.length > 40) {
                     page.drawText(line, { x: loc.x + 80, y: loc.y - yOffset, size: 10, color: rgb(1, 0, 0), font });
                     line = '';
                     yOffset += 12;
                }
                line += w;
            }
            page.drawText(line, { x: loc.x + 80, y: loc.y - yOffset, size: 10, color: rgb(1, 0, 0), font });
        }
        else if (loc.type === 'instructor' && instructor) {
            // If image mode and image loaded successfully
            if (instructor.mode === 'image' && signatureImage) {
                 // Draw Image
                 const dims = signatureImage.scale(0.5); // Scale down 50% usually good
                 // Ensure it doesn't exceed bounds
                 const width = Math.min(dims.width, 100);
                 const height = (width / dims.width) * dims.height;

                 page.drawImage(signatureImage, {
                    x: loc.x + 60,
                    y: loc.y - 10,
                    width: width,
                    height: height,
                 });
            } else {
                 // Draw Text Name
                 const name = instructor.name || "AI Grader";
                 page.drawText(name, { x: loc.x + 60, y: loc.y, size: 12, color: rgb(0, 0, 0), font });
            }
        }
    }
    
    if (locations.length === 0) {
        const page = pdfDoc.addPage();
        page.drawText("Grading Report", { x: 50, y: 700, size: 20, font });
        page.drawText(`Score: ${result.score}`, { x: 50, y: 650, size: 14, color: rgb(1, 0, 0), font });
        page.drawText(`Comment: (See dashboard for full text)`, { x: 50, y: 620, size: 12, font });
        if (instructor) {
            page.drawText(`Instructor: ${instructor.name}`, { x: 50, y: 590, size: 12, font });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: FileType.PDF });
};

// Return a Blob for generic reports
const generateReportPDFBlob = (originalFileName: string, result: any, instructor?: InstructorSettings): Blob => {
  if (!window.jspdf) {
    throw new Error("jsPDF not loaded");
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.setTextColor(79, 70, 229);
  doc.text("Grading Report", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`File: ${originalFileName}`, 14, 30);
  
  doc.text(`Score: ${result.score}`, 14, 45);
  // Split long summary
  const summaryLines = doc.splitTextToSize(result.summary, 180);
  doc.text(summaryLines, 14, 55);

  if (instructor) {
      doc.text(`Instructor: ${instructor.name}`, 14, 100);
      // Basic image support for JSPDF fallback
      if (instructor.mode === 'image' && instructor.imageData) {
          try {
             doc.addImage(instructor.imageData, 'PNG', 14, 110, 40, 20);
          } catch(e) {}
      }
  }

  return doc.output('blob');
};

export const generateReportPDF = (name: string, result: any, instructor?: InstructorSettings) => {
    const blob = generateReportPDFBlob(name, result, instructor);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Report_${name}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};