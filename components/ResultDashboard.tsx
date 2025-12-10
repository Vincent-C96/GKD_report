import React from 'react';
import { GradingResult, FeedbackItem, InstructorSettings } from '../types';
import { annotateAndDownloadFile } from '../services/fileService';
import { 
  CheckCircle, 
  AlertCircle, 
  MinusCircle, 
  Download, 
  Award, 
  RefreshCw,
  ArrowLeft
} from 'lucide-react';

interface ResultDashboardProps {
  result: GradingResult;
  originalFileName: string;
  onReset: () => void;
  onBack?: () => void; // Optional back handler for batch mode
  file: File;
  instructorSettings: InstructorSettings;
}

const ScoreRing: React.FC<{ score: number, letter: string }> = ({ score, letter }) => {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  let color = 'text-red-500';
  if(score >= 80) color = 'text-emerald-500';
  else if(score >= 60) color = 'text-amber-500';

  return (
    <div className="relative w-40 h-40 flex items-center justify-center">
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke="currentColor"
          strokeWidth="10"
          fill="transparent"
          className="text-slate-200"
        />
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke="currentColor"
          strokeWidth="10"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-4xl font-bold ${color}`}>{score}</span>
        <span className="text-xl font-semibold text-slate-600">Grade {letter}</span>
      </div>
    </div>
  );
};

const ResultDashboard: React.FC<ResultDashboardProps> = ({ result, originalFileName, onReset, onBack, file, instructorSettings }) => {
  
  const handleDownload = async () => {
    // Pass the actual file to be annotated and the instructor settings
    await annotateAndDownloadFile(file, result, instructorSettings);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Back Button for Batch Mode */}
      {onBack && (
        <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-500 hover:text-primary transition-colors mb-4 font-medium"
        >
            <ArrowLeft className="w-4 h-4" />
            Back to Batch List
        </button>
      )}

      {/* Header Stats */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center justify-between">
        <div className="flex flex-col md:flex-row items-center gap-8">
            <ScoreRing score={result.score} letter={result.letter_grade} />
            <div className="max-w-xl text-center md:text-left">
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Assessment Summary</h2>
                <div className="text-sm font-semibold text-slate-400 mb-1">{originalFileName}</div>
                <p className="text-slate-600 leading-relaxed">{result.summary}</p>
            </div>
        </div>
        <div className="flex flex-col gap-3 min-w-[200px]">
            <button 
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 bg-primary hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-200"
            >
                <Download className="w-5 h-5" />
                Download Graded File
            </button>
            <p className="text-xs text-center text-slate-400">
                Adds comments {instructorSettings.mode === 'image' && instructorSettings.imageData ? '& signature' : ''} to file
            </p>
            {!onBack && (
                <button 
                    onClick={onReset}
                    className="flex items-center justify-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-6 py-3 rounded-lg font-medium transition-colors"
                >
                    <RefreshCw className="w-5 h-5" />
                    Grade Another
                </button>
            )}
        </div>
      </div>
      
      {/* Teacher Comment Preview */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 relative">
          <h3 className="text-indigo-900 font-bold mb-2 flex items-center gap-2">
            <Award className="w-5 h-5" />
            Teacher's Comment (Added to File)
          </h3>
          <p className="text-indigo-800 italic">
            "{result.teacher_comment}"
          </p>
          <div className="mt-4 flex items-center justify-end gap-2 text-indigo-700/60 text-sm">
             <span>Instructor:</span>
             {instructorSettings.mode === 'image' && instructorSettings.imageData ? (
                 <img src={instructorSettings.imageData} alt="Sig" className="h-8 border border-indigo-200 rounded bg-white" />
             ) : (
                 <span className="font-serif font-bold italic">{instructorSettings.name}</span>
             )}
          </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Award className="w-5 h-5 text-accent" />
                Detailed Analysis
            </h3>
            <span className="text-sm text-slate-500">{result.feedback.length} items found</span>
        </div>
        <div className="divide-y divide-slate-100">
            {result.feedback.map((item, index) => (
                <FeedbackRow key={index} item={item} />
            ))}
        </div>
      </div>
    </div>
  );
};

const FeedbackRow: React.FC<{ item: FeedbackItem }> = ({ item }) => {
  const getIcon = () => {
    if (item.sentiment === 'positive') return <CheckCircle className="w-6 h-6 text-emerald-500 shrink-0" />;
    if (item.sentiment === 'negative') return <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />;
    return <MinusCircle className="w-6 h-6 text-slate-400 shrink-0" />;
  };

  const getBorderColor = () => {
    if (item.sentiment === 'positive') return 'border-l-4 border-emerald-500';
    if (item.sentiment === 'negative') return 'border-l-4 border-red-500';
    return 'border-l-4 border-slate-300';
  };

  return (
    <div className={`p-6 hover:bg-slate-50 transition-colors flex gap-4 ${getBorderColor()}`}>
        <div className="pt-1">{getIcon()}</div>
        <div className="flex-1 space-y-2">
            <div className="flex justify-between items-start">
                <blockquote className="text-slate-800 font-medium italic border-l-2 border-slate-200 pl-3 py-1 text-sm bg-slate-50 rounded">
                    "{item.original_text}"
                </blockquote>
                <span className={`text-sm font-bold px-2 py-1 rounded ${item.score_impact > 0 ? 'bg-emerald-100 text-emerald-700' : item.score_impact < 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    {item.score_impact > 0 ? '+' : ''}{item.score_impact} pts
                </span>
            </div>
            <p className="text-slate-600 text-sm">
                <span className="font-semibold text-slate-700">Analysis: </span>
                {item.comment}
            </p>
            {item.suggestion && (
                <div className="text-sm bg-indigo-50 text-indigo-800 p-3 rounded-md mt-2">
                    <span className="font-semibold">Suggestion: </span>
                    {item.suggestion}
                </div>
            )}
        </div>
    </div>
  );
};

export default ResultDashboard;