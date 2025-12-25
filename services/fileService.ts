import { FileType, GradingResult, InstructorSettings } from '../types';

// Keywords to identify target locations in the document
// Sorted by length DESCENDING to prioritize longer matches (e.g. find "教师评语" before "评语")
const SCORE_KEYWORDS = ['评分', '得分', '分数', 'Score', 'Grade', 'Points', 'Mark'].sort((a, b) => b.length - a.length);
const COMMENT_KEYWORDS = ['Teacher Comments', '教师评语', '老师评语', '评语', '建议', '评价', 'Comments', 'Feedback', 'Remarks'].sort((a, b) => b.length - a.length);
const INSTRUCTOR_KEYWORDS = ['指导教师', '教师签名', '签名', 'Instructor', 'Teacher', 'Signature', 'Signed by'].sort((a, b) => b.length - a.length);

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
      // Fallback based on extension if type is missing
      if (file.name.endsWith('.docx')) return await parseWord(file);
      if (file.name.endsWith('.xlsx')) return await parseExcel(file);
      if (file.name.endsWith('.pdf')) return await parsePdf(file);
      
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    console.error("Error extracting text:", error);
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
    const name = entry.name;
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('__macosx') || lowerName.startsWith('.')) continue;

    let type: string | null = null;
    if (lowerName.endsWith('.docx')) type = FileType.WORD;
    else if (lowerName.endsWith('.xlsx')) type = FileType.EXCEL;
    else if (lowerName.endsWith('.pdf')) type = FileType.PDF;

    if (!type) continue;

    try {
        const blob = await entry.async('blob');
        const cleanName = name.split('/').pop() || name;
        const file = new File([blob], cleanName, { type: type });
        files.push(file);
    } catch (e) {
        console.warn(`Failed to extract entry ${name}:`, e);
    }
  }
  return files;
};

// --- Image Generation (Canvas) ---

interface TextImageOptions {
    maxWidth?: number;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    isMultiLine?: boolean;
}

const createTextImage = (text: string, options: TextImageOptions = {}): { dataUrl: string, width: number, height: number } | null => {
    if (!text) return null;
    
    const {
        maxWidth = 800,
        color = '#000000',
        fontSize = 18, 
        fontFamily = "'Microsoft YaHei', 'SimHei', 'SimSun', 'PingFang SC', 'Inter', sans-serif",
        isMultiLine = false
    } = options;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `${fontSize}px ${fontFamily}`;
    
    // 1. Line Breaking Logic
    const lines: string[] = [];
    if (isMultiLine) {
        const characters = text.split('');
        let currentLine = '';
        
        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            const testLine = currentLine + char;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && i > 0) {
                lines.push(currentLine);
                currentLine = char;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);
    } else {
        lines.push(text);
    }

    // 2. Measure Canvas Size
    let maxLineWidth = 0;
    lines.forEach(line => {
        const m = ctx.measureText(line);
        if (m.width > maxLineWidth) maxLineWidth = m.width;
    });

    const lineHeight = fontSize * 1.4;
    const canvasWidth = Math.ceil(maxLineWidth + 10);
    const canvasHeight = Math.ceil(lines.length * lineHeight);

    // 3. Set Canvas & Draw
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;

    lines.forEach((line, index) => {
        ctx.fillText(line, 0, index * lineHeight);
    });

    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvasWidth,
        height: canvasHeight
    };
};

const createSignatureImage = (text: string, isArtistic: boolean): string | null => {
    const family = isArtistic 
        ? "'Ma Shan Zheng', 'Dancing Script', 'Brush Script MT', cursive" 
        : "'Inter', sans-serif";
        
    const result = createTextImage(text, {
        fontSize: 48,
        fontFamily: family,
        color: '#000000'
    });
    return result ? result.dataUrl : null;
};

// --- Annotation Logic ---

export const getAnnotatedFileBlob = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<{ blob: Blob, extension: string }> => {
  const fileType = file.type || getMimeTypeFromExtension(file.name);
  let blob: Blob | null = null;
  let extension = '';

  try {
    if (fileType === FileType.WORD || file.name.endsWith('.docx')) {
      blob = await annotateWord(file, result, instructor);
      extension = 'docx';
    } else if (fileType === FileType.EXCEL || file.name.endsWith('.xlsx')) {
      blob = await annotateExcel(file, result, instructor);
      extension = 'xlsx';
    } else if (fileType === FileType.PDF || file.name.endsWith('.pdf')) {
      blob = await annotatePdf(file, result, instructor);
      extension = 'pdf';
    } else {
        throw new Error("Unsupported file type for annotation");
    }

    return { blob, extension };
  } catch (e) {
    console.error("Failed to annotate file, falling back to PDF report:", e);
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

export const annotateAndDownloadFile = async (file: File, result: GradingResult, instructor?: InstructorSettings) => {
    const { blob, extension } = await getAnnotatedFileBlob(file, result, instructor);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Graded_${file.name.split('.')[0]}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

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
    
    if (SCORE_KEYWORDS.some(k => textContent.includes(k))) {
      const nextCell = cell.nextElementSibling;
      if (nextCell && !modifiedNodes.has(nextCell)) {
        updateWordParagraph(xmlDoc, nextCell, `${result.score} / 100`, "FF0000"); 
        modifiedNodes.add(nextCell);
      }
    }
    if (COMMENT_KEYWORDS.some(k => textContent.includes(k))) {
        const nextCell = cell.nextElementSibling;
        if (nextCell && !modifiedNodes.has(nextCell)) {
          updateWordParagraph(xmlDoc, nextCell, result.teacher_comment, "FF0000");
          modifiedNodes.add(nextCell);
        } 
    }
    if (instructor && instructor.enabled && INSTRUCTOR_KEYWORDS.some(k => textContent.includes(k))) {
        const nextCell = cell.nextElementSibling;
        if (nextCell && !modifiedNodes.has(nextCell)) {
             const signText = instructor.name || "AI Grader";
             const fontName = (instructor.fontStyle === 'artistic') ? 'KaiTi' : undefined;
             updateWordParagraph(xmlDoc, nextCell, signText, "000000", fontName);
             modifiedNodes.add(nextCell);
        }
    }
  }

  // Generic paragraphs
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

const updateWordParagraph = (doc: Document, parent: Element, text: string, colorHex: string, fontName?: string) => {
    let p = parent.getElementsByTagName("w:p")[0];
    if (!p) {
        p = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:p");
        parent.appendChild(p);
    }
    const pPr = p.getElementsByTagName("w:pPr")[0];
    while (p.firstChild) { p.removeChild(p.firstChild); }
    if (pPr) { p.appendChild(pPr); }

    const r = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:r");
    const rPr = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:rPr");
    
    const color = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:color");
    color.setAttribute("w:val", colorHex);
    rPr.appendChild(color);

    if (fontName) {
        const rFonts = doc.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:rFonts");
        rFonts.setAttribute("w:ascii", fontName);
        rFonts.setAttribute("w:hAnsi", fontName);
        rFonts.setAttribute("w:eastAsia", fontName);
        rPr.appendChild(rFonts);
    }

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
                            const writeToNextCell = (text: string) => {
                                const targetAddress = window.XLSX.utils.encode_cell({r: R, c: C + 1});
                                const targetCell = sheet[targetAddress] || { t: 's', v: '' };
                                targetCell.v = text;
                                targetCell.t = 's';
                                sheet[targetAddress] = targetCell;
                            };

                            if (SCORE_KEYWORDS.some(k => val.includes(k))) writeToNextCell(`${result.score}/100`);
                            if (COMMENT_KEYWORDS.some(k => val.includes(k))) writeToNextCell(result.teacher_comment);
                            if (instructor && instructor.enabled && INSTRUCTOR_KEYWORDS.some(k => val.includes(k))) {
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

interface PdfLocation {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    isVertical: boolean; // Flag to indicate vertical layout
    type: 'score' | 'comment' | 'instructor';
}

const annotatePdf = async (file: File, result: GradingResult, instructor?: InstructorSettings): Promise<Blob> => {
    if (!window.pdfjsLib || !window.PDFLib) throw new Error("PDF libraries not loaded");

    const arrayBuffer = await file.arrayBuffer();
    const locations: PdfLocation[] = [];
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    const pdf = await loadingTask.promise;

    // Helper for collision detection
    const isOverlapping = (r1: PdfLocation, r2: PdfLocation) => {
        // Check if boxes intersect
        return !(r2.x > r1.x + r1.width || 
                 r2.x + r2.width < r1.x || 
                 r2.y > r1.y + r1.height || 
                 r2.y + r2.height < r1.y);
    };

    // Advanced Text Search with Bounding Boxes
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // 1. Map all characters on the page
        const charMap: { char: string, x: number, y: number, w: number, h: number }[] = [];
        
        textContent.items.forEach((item: any) => {
            const str = item.str;
            const x = item.transform[4];
            const y = item.transform[5];
            const w = item.width;
            const h = item.height;
            
            // Approximate per-character width
            const charW = w / str.length;
            
            for(let c = 0; c < str.length; c++) {
                 charMap.push({
                     char: str[c],
                     x: x + (c * charW),
                     y: y,
                     w: charW,
                     h: h
                 });
            }
        });

        const fullPageStr = charMap.map(c => c.char).join('');
        
        // 2. Helper to find locations
        const findAndAdd = (keywords: string[], type: 'score' | 'comment' | 'instructor') => {
            keywords.forEach(keyword => {
                let startIndex = 0;
                while(true) {
                    const idx = fullPageStr.indexOf(keyword, startIndex);
                    if (idx === -1) break;

                    // Calculate Bounding Box of the found keyword
                    const foundChars = charMap.slice(idx, idx + keyword.length);
                    if (foundChars.length > 0) {
                        const minX = Math.min(...foundChars.map(c => c.x));
                        const maxX = Math.max(...foundChars.map(c => c.x + c.w));
                        const minY = Math.min(...foundChars.map(c => c.y));
                        const maxY = Math.max(...foundChars.map(c => c.y + c.h));
                        
                        const width = maxX - minX;
                        const height = maxY - minY;

                        // Heuristic: If height is significantly larger than width, it's vertical
                        const isVertical = height > (width * 1.2);

                        const candidateLoc: PdfLocation = {
                            page: i - 1,
                            x: minX,
                            y: minY, 
                            width,
                            height,
                            isVertical,
                            type
                        };

                        // Check for overlap with existing locations on this page
                        // Since keywords are sorted by length DESC, first match is best.
                        // We skip if a better (longer) or existing match covers this area.
                        const exists = locations.some(l => l.page === (i-1) && isOverlapping(l, candidateLoc));
                        
                        if (!exists) {
                            locations.push(candidateLoc);
                        }
                    }
                    startIndex = idx + 1;
                }
            });
        };

        findAndAdd(SCORE_KEYWORDS, 'score');
        findAndAdd(COMMENT_KEYWORDS, 'comment');
        if (instructor) findAndAdd(INSTRUCTOR_KEYWORDS, 'instructor');
    }

    const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    const { rgb } = window.PDFLib;
    
    // Embed assets
    let signatureImage = null;
    if (instructor && instructor.enabled) {
        if (instructor.mode === 'image' && instructor.imageData) {
            try {
                if (instructor.imageData.startsWith('data:image/png')) signatureImage = await pdfDoc.embedPng(instructor.imageData);
                else signatureImage = await pdfDoc.embedJpg(instructor.imageData);
            } catch (e) { console.warn("Sig embed failed", e); }
        } else if (instructor.mode === 'text' && instructor.name) {
             const genDataUrl = createSignatureImage(instructor.name, instructor.fontStyle === 'artistic');
             if (genDataUrl) signatureImage = await pdfDoc.embedPng(genDataUrl);
        }
    }

    const scoreImgData = createTextImage(`${result.score}`, { fontSize: 36, color: '#FF0000', fontFamily: 'Arial, sans-serif' });
    let scoreImage = scoreImgData ? await pdfDoc.embedPng(scoreImgData.dataUrl) : null;

    // Process locations
    for (const loc of locations) {
        const page = pages[loc.page];
        const { width, height } = page.getSize();
        
        if (loc.type === 'score' && scoreImage && scoreImgData) {
             const startX = loc.x + loc.width + 50;
             const scale = 0.5;
             // Removed white background rectangle
             page.drawImage(scoreImage, {
                x: startX,
                y: loc.y,
                width: scoreImgData.width * scale,
                height: scoreImgData.height * scale
            });
        } 
        else if (loc.type === 'comment') {
            const pageW = width;
            
            // Fixed configuration as requested
            const margin = 50;
            const targetWidth = 350;

            let drawX = 0;
            let targetTopY = 0;

            if (loc.isVertical) {
                // VERTICAL LAYOUT
                drawX = loc.x + loc.width + margin;
                targetTopY = loc.y + loc.height;
            } else {
                // HORIZONTAL LAYOUT
                drawX = loc.x + loc.width + margin;
                targetTopY = loc.y + 10;
            }
            
            // Check overflow
            let finalWidth = targetWidth;
            let moveDown = false;

            if (drawX + targetWidth > pageW - 20) {
                 moveDown = true;
                 drawX = 40;
                 finalWidth = pageW - 80; // Use full width if moved down
            }

            // Generate Image
            const canvasMaxWidth = finalWidth * 2;
            
            const commentImgData = createTextImage(result.teacher_comment || "No comments generated.", { 
                fontSize: 18, 
                color: '#FF0000', 
                maxWidth: canvasMaxWidth, 
                isMultiLine: true 
            });

            if (commentImgData) {
                const commentImage = await pdfDoc.embedPng(commentImgData.dataUrl);
                const scale = 0.5;
                const finalImageW = commentImgData.width * scale;
                const finalImageH = commentImgData.height * scale;

                let drawY = targetTopY - finalImageH; 

                if (moveDown) {
                    drawY = loc.y - 15 - finalImageH;
                }

                if (drawY < 30) {
                    drawY = 30; 
                }

                // Removed white background rectangle
                page.drawImage(commentImage, {
                    x: drawX,
                    y: drawY,
                    width: finalImageW,
                    height: finalImageH
                });
            }
        }
        else if (loc.type === 'instructor' && instructor && instructor.enabled && signatureImage) {
            const dims = signatureImage.scale(0.5);
            const maxWidth = 150;
            let w = dims.width;
            let h = dims.height;
            if (w > maxWidth) {
                w = maxWidth;
                h = (maxWidth / dims.width) * dims.height;
            }
            
            page.drawImage(signatureImage, {
                x: loc.x + loc.width + 20,
                y: loc.y - 5,
                width: w,
                height: h,
            });
        }
    }
    
    // Fallback: If no locations found
    if (locations.length === 0) {
        const page = pdfDoc.addPage();
        const font = await pdfDoc.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
        page.drawText("Grading Report", { x: 50, y: 700, size: 20, font });
        
        if (scoreImage && scoreImgData) {
            page.drawText("Score:", { x: 50, y: 650, size: 14, color: rgb(0,0,0), font });
            page.drawImage(scoreImage, { x: 100, y: 650, width: scoreImgData.width * 0.5, height: scoreImgData.height * 0.5 });
        }
        
         const fbCommentImgData = createTextImage(result.teacher_comment || "No comments.", { 
            fontSize: 18, 
            color: '#FF0000', 
            maxWidth: 1000, 
            isMultiLine: true 
        });
        if (fbCommentImgData) {
            const fbCommentImage = await pdfDoc.embedPng(fbCommentImgData.dataUrl);
            page.drawText("Comments:", { x: 50, y: 600, size: 14, font });
            page.drawImage(fbCommentImage, { x: 50, y: 580 - (fbCommentImgData.height*0.5), width: fbCommentImgData.width * 0.5, height: fbCommentImgData.height * 0.5 });
        }

        if (instructor && instructor.enabled && signatureImage) {
             page.drawText(`Instructor:`, { x: 50, y: 400, size: 12, font });
             page.drawImage(signatureImage, { x: 120, y: 390, width: 100, height: 50 });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: FileType.PDF });
};

const generateReportPDFBlob = (originalFileName: string, result: any, instructor?: InstructorSettings): Blob => {
  if (!window.jspdf) throw new Error("jsPDF not loaded");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.setTextColor(79, 70, 229);
  doc.text("Grading Report", 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`File: ${originalFileName}`, 14, 30);
  
  doc.text(`Score: ${result.score}`, 14, 45);
  const summaryLines = doc.splitTextToSize(result.summary, 180);
  doc.text(summaryLines, 14, 55);

  if (instructor && instructor.enabled) {
      doc.text(`Instructor: ${instructor.name}`, 14, 100);
      if (instructor.mode === 'image' && instructor.imageData) {
          try { doc.addImage(instructor.imageData, 'PNG', 14, 110, 40, 20); } catch(e) {}
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