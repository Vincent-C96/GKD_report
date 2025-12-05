import React, { useCallback, useState } from 'react';
import { UploadCloud, FileText, FileSpreadsheet, File as FileIcon, Archive, Loader2 } from 'lucide-react';
import { extractFilesFromZip } from '../services/fileService';

interface FileUploadProps {
  onFileSelect: (files: File[]) => void;
  isProcessing: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isProcessing }) => {
  const [isExpanding, setIsExpanding] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isProcessing || isExpanding) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files) as File[];
      validateAndUpload(files);
    }
  }, [isProcessing, isExpanding]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files) as File[];
      validateAndUpload(files);
    }
  };

  const validateAndUpload = async (files: File[]) => {
    setIsExpanding(true);
    const validFiles: File[] = [];
    
    try {
        for (const file of files) {
            const lowerName = file.name.toLowerCase();
            
            // Check for ZIP by extension or generic mime type
            if (lowerName.endsWith('.zip') || file.type.includes('zip') || file.type.includes('compressed')) {
                // Expand zip
                try {
                    const extracted = await extractFilesFromZip(file);
                    if (extracted.length === 0) {
                        alert(`No supported files (docx, xlsx, pdf) found in ${file.name}`);
                    }
                    validFiles.push(...extracted);
                } catch (e) {
                    console.error("Unzip error:", e);
                    alert(`Failed to unzip ${file.name}. Please ensure it is a valid zip file.`);
                }
            } else if (lowerName.endsWith('.docx') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.pdf')) {
                validFiles.push(file);
            }
        }

        if (validFiles.length > 0) {
            onFileSelect(validFiles);
        } else if (files.length > 0 && validFiles.length === 0) {
            // Only alert if we had files but none were valid
            // (e.g. ignoring a random .txt file is fine, but if that's all there is, warn user)
            const wasZip = files.some(f => f.name.endsWith('.zip'));
            if (!wasZip) {
               alert("No valid files found. Please upload .docx, .xlsx, .pdf, or .zip files containing them.");
            }
        }
    } catch(err) {
        console.error("Error processing files", err);
        alert("An error occurred while processing the files.");
    } finally {
        setIsExpanding(false);
    }
  };

  return (
    <div 
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-all duration-300 cursor-pointer
        ${(isProcessing || isExpanding) ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-300' : 'border-primary/40 hover:border-primary hover:bg-indigo-50/30 bg-white'}`}
    >
      <input 
        type="file" 
        id="fileInput" 
        className="hidden" 
        accept=".docx,.xlsx,.pdf,.zip,application/zip,application/x-zip-compressed,multipart/x-zip"
        multiple
        onChange={handleChange}
        disabled={isProcessing || isExpanding}
      />
      <label htmlFor="fileInput" className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
        <div className="bg-indigo-100 p-4 rounded-full mb-4">
          {isExpanding ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <UploadCloud className="w-8 h-8 text-primary" />
          )}
        </div>
        <h3 className="text-lg font-semibold text-slate-800">
          {isExpanding ? 'Unzipping and preparing files...' : 
           isProcessing ? 'Processing Files...' : 'Click to upload files or drag & drop'}
        </h3>
        <p className="text-slate-500 mt-2 text-sm">
          Supports Word (.docx), Excel (.xlsx), PDF (.pdf), and ZIP archives
        </p>
        <div className="flex gap-4 mt-6 justify-center">
            <div className="flex items-center gap-1 text-xs text-slate-400">
                <FileText className="w-4 h-4" /> DOCX
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
                <FileSpreadsheet className="w-4 h-4" /> XLSX
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
                <FileIcon className="w-4 h-4" /> PDF
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
                <Archive className="w-4 h-4" /> ZIP
            </div>
        </div>
      </label>
    </div>
  );
};

export default FileUpload;