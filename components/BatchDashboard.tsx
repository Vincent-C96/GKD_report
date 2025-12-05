import React from 'react';
import { BatchItem } from '../types';
import { annotateAndDownloadFile, downloadBatchAsZip } from '../services/fileService';
import { 
  CheckCircle, 
  Clock, 
  Loader2, 
  AlertTriangle,
  FileText,
  Download,
  Eye,
  Archive,
  ArrowRight
} from 'lucide-react';

interface BatchDashboardProps {
  items: BatchItem[];
  onViewDetails: (id: string) => void;
  onReset: () => void;
}

const BatchDashboard: React.FC<BatchDashboardProps> = ({ items, onViewDetails, onReset }) => {
  
  const completedItems = items.filter(i => i.status === 'completed' && i.result);
  const isProcessing = items.some(i => i.status === 'processing' || i.status === 'queued');
  const hasCompleted = completedItems.length > 0;
  
  const handleDownloadAll = async () => {
    if (completedItems.length === 0) return;

    // If only one file is completed, download it directly (no zip)
    if (completedItems.length === 1) {
        const item = completedItems[0];
        await annotateAndDownloadFile(item.file, item.result!);
    } else {
        // Otherwise, zip them up
        const toDownload = completedItems.map(item => ({
            file: item.file,
            result: item.result!
        }));
        await downloadBatchAsZip(toDownload);
    }
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
        case 'completed': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
        case 'processing': return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
        case 'error': return <AlertTriangle className="w-5 h-5 text-red-500" />;
        default: return <Clock className="w-5 h-5 text-slate-300" />;
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Batch Results</h2>
            <p className="text-slate-500 text-sm mt-1">
                Processed {completedItems.length} of {items.length} files
            </p>
        </div>
        <div className="flex gap-3 mt-4 md:mt-0">
             {hasCompleted && (
                <button 
                    onClick={handleDownloadAll}
                    disabled={isProcessing && completedItems.length === 0}
                    className="flex items-center gap-2 bg-primary hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {completedItems.length > 1 ? (
                        <>
                            <Archive className="w-4 h-4" />
                            Download All (.zip)
                        </>
                    ) : (
                        <>
                            <Download className="w-4 h-4" />
                            Download File
                        </>
                    )}
                </button>
             )}
            <button 
                onClick={onReset}
                disabled={isProcessing}
                className="px-5 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
                Start Over
            </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                    <th className="py-4 px-6 font-semibold text-slate-600 text-sm">File Name</th>
                    <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Status</th>
                    <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Grade</th>
                    <th className="py-4 px-6 font-semibold text-slate-600 text-sm text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-50 p-2 rounded-lg text-primary">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <span className="font-medium text-slate-700 truncate max-w-[200px]" title={item.file.name}>
                                    {item.file.name}
                                </span>
                            </div>
                        </td>
                        <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                                {getStatusIcon(item.status)}
                                <span className={`text-sm ${item.status === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                                    {item.status === 'error' ? item.error : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                                </span>
                            </div>
                        </td>
                        <td className="py-4 px-6">
                            {item.result ? (
                                <span className={`font-bold ${
                                    item.result.score >= 80 ? 'text-emerald-600' : 
                                    item.result.score >= 60 ? 'text-amber-600' : 'text-red-600'
                                }`}>
                                    {item.result.score} <span className="text-xs font-normal text-slate-400">/ 100</span>
                                </span>
                            ) : (
                                <span className="text-slate-300">-</span>
                            )}
                        </td>
                        <td className="py-4 px-6 text-right">
                            <div className="flex justify-end gap-2">
                                {item.status === 'completed' && item.result && (
                                    <>
                                        <button 
                                            onClick={() => onViewDetails(item.id)}
                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                            title="View Analysis"
                                        >
                                            <Eye className="w-5 h-5" />
                                        </button>
                                        <button 
                                            onClick={() => annotateAndDownloadFile(item.file, item.result!)}
                                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                            title="Download Annotated File"
                                        >
                                            <Download className="w-5 h-5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
        
        {items.length === 0 && (
            <div className="p-8 text-center text-slate-400">
                No files in queue.
            </div>
        )}
      </div>
    </div>
  );
};

export default BatchDashboard;