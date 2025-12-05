// Define window extensions for CDN libraries
declare global {
  interface Window {
    mammoth: any;
    XLSX: any;
    pdfjsLib: any;
    jspdf: any;
    JSZip: any;
    PDFLib: any;
  }
}

export enum FileType {
  WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PDF = 'application/pdf',
  UNKNOWN = 'unknown'
}

export interface FeedbackItem {
  original_text: string;
  comment: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score_impact: number; // e.g., -5, +2, 0
  suggestion?: string;
}

export interface GradingResult {
  score: number;
  letter_grade: string;
  summary: string;
  teacher_comment: string; // New field for the form
  feedback: FeedbackItem[];
}

export interface UploadedFile {
  file: File;
  content: string; // Extracted text content
  type: FileType;
}

// Batch Processing Types
export type BatchStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface BatchItem {
  id: string;
  file: File;
  status: BatchStatus;
  result?: GradingResult;
  error?: string;
}

// AI Configuration Types
export type AIProvider = 'gemini' | 'doubao';

export interface AIConfig {
  provider: AIProvider;
  doubaoEndpointId?: string; // e.g. ep-2025...
  proxyUrl?: string; // To bypass CORS
}

export interface GradeOptions {
  minScore: number;
  maxScore: number;
  aiConfig: AIConfig;
}