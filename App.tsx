import React, { useState, useEffect } from 'react';
import { GradingResult, BatchItem, AIProvider, AIConfig } from './types';
import FileUpload from './components/FileUpload';
import ResultDashboard from './components/ResultDashboard';
import BatchDashboard from './components/BatchDashboard';
import { extractTextFromFile } from './services/fileService';
import { gradeDocument } from './services/geminiService';
import { GraduationCap, Settings, Bot, Network, Key } from 'lucide-react';

const App: React.FC = () => {
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isQueueProcessing, setIsQueueProcessing] = useState(false);
  
  // Grading Settings
  const [minScore, setMinScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(100);

  // AI Settings
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [doubaoEndpoint, setDoubaoEndpoint] = useState<string>('ep-20250212093506-69677');
  const [proxyUrl, setProxyUrl] = useState<string>(''); 

  // When files are selected, add them to the queue
  const handleFileSelect = (files: File[]) => {
    const newItems: BatchItem[] = files.map(file => ({
        id: Math.random().toString(36).substring(7),
        file: file,
        status: 'queued'
    }));
    
    setBatchItems(newItems);
    setIsQueueProcessing(true);
  };

  // Effect to process queue sequentially
  useEffect(() => {
    const processNext = async () => {
        if (!isQueueProcessing) return;

        // Find next queued item
        const nextItemIndex = batchItems.findIndex(i => i.status === 'queued');
        
        if (nextItemIndex === -1) {
            setIsQueueProcessing(false);
            return;
        }

        const currentItem = batchItems[nextItemIndex];

        // Update status to processing
        setBatchItems(prev => {
            const copy = [...prev];
            copy[nextItemIndex] = { ...copy[nextItemIndex], status: 'processing' };
            return copy;
        });

        try {
            // 1. Extract Text
            const textContent = await extractTextFromFile(currentItem.file);
            
            if (!textContent || textContent.trim().length < 50) {
                throw new Error("Empty or unreadable document.");
            }

            // 2. Prepare AI Config
            const aiConfig: AIConfig = {
                provider: aiProvider,
                doubaoEndpointId: doubaoEndpoint,
                proxyUrl: proxyUrl.trim()
            };

            // 3. Grade
            const result = await gradeDocument(textContent, { minScore, maxScore, aiConfig });
            
            // 4. THROTTLE
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Update success
            setBatchItems(prev => {
                const copy = [...prev];
                copy[nextItemIndex] = { 
                    ...copy[nextItemIndex], 
                    status: 'completed', 
                    result: result 
                };
                return copy;
            });

        } catch (err: any) {
            console.error("Error processing file", currentItem.file.name, err);
            
            const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
            
            if (isRateLimit) {
                console.warn("CRITICAL RATE LIMIT: Pausing queue for 60 seconds...");
                await new Promise(resolve => setTimeout(resolve, 60000));
            } else {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Update error
            setBatchItems(prev => {
                const copy = [...prev];
                copy[nextItemIndex] = { 
                    ...copy[nextItemIndex], 
                    status: 'error', 
                    error: (err as Error).message 
                };
                return copy;
            });
        }
    };

    if (isQueueProcessing) {
        processNext();
    }
  }, [batchItems, isQueueProcessing, minScore, maxScore, aiProvider, doubaoEndpoint, proxyUrl]);


  const handleReset = () => {
    setBatchItems([]);
    setSelectedItemId(null);
    setIsQueueProcessing(false);
  };

  const selectedItem = batchItems.find(i => i.id === selectedItemId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-indigo-50">
      
      {/* Navbar */}
      <nav className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-indigo-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary p-2 rounded-lg">
                <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
              AI Smart Grader
            </span>
          </div>
          <div className="text-sm font-medium text-slate-500 hidden sm:flex items-center gap-2">
             <Bot className="w-4 h-4" />
             Running on: <span className="text-primary font-bold uppercase">{aiProvider}</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        
        {/* Intro Section (only show if empty) */}
        {batchItems.length === 0 && (
            <div className="text-center mb-12 animate-fadeIn">
                <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6 tracking-tight">
                    Instant AI Feedback for <br />
                    <span className="text-primary">Every Assignment</span>
                </h1>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                    Upload Word, Excel, or PDF documents. We use AI to score, critique, and annotate your student's work automatically.
                </p>
            </div>
        )}

        {/* Settings & Upload Area */}
        {batchItems.length === 0 && (
            <div className="max-w-3xl mx-auto space-y-8">
                {/* Configuration Panel */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-slate-500" />
                        Grading Configuration
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        {/* Score Range */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Score Range
                            </label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    value={minScore}
                                    onChange={(e) => setMinScore(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                    placeholder="Min"
                                />
                                <span className="text-slate-400">-</span>
                                <input 
                                    type="number" 
                                    value={maxScore}
                                    onChange={(e) => setMaxScore(Number(e.target.value))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                    placeholder="Max"
                                />
                            </div>
                        </div>

                        {/* AI Provider */}
                        <div>
                             <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                AI Model
                            </label>
                            <select 
                                value={aiProvider}
                                onChange={(e) => setAiProvider(e.target.value as AIProvider)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            >
                                <option value="gemini">Google Gemini 2.5 Flash (Recommended)</option>
                                <option value="doubao">Volcengine Doubao (Pro)</option>
                            </select>
                        </div>
                    </div>

                    {/* Doubao Specific Settings */}
                    {aiProvider === 'doubao' && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-4 animate-fadeIn">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                    <Key className="w-3 h-3" /> Endpoint ID
                                </label>
                                <input 
                                    type="text" 
                                    value={doubaoEndpoint}
                                    onChange={(e) => setDoubaoEndpoint(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                    placeholder="ep-202xxxxxxxx-xxxxx"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                    <Network className="w-3 h-3" /> CORS Proxy URL (Required for Browser)
                                </label>
                                <input 
                                    type="text" 
                                    value={proxyUrl}
                                    onChange={(e) => setProxyUrl(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                    placeholder="https://cors-anywhere.herokuapp.com/"
                                />
                                <p className="text-xs text-slate-400 mt-1">
                                    Doubao API does not support direct browser calls. Use a proxy service or localhost proxy.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <FileUpload onFileSelect={handleFileSelect} isProcessing={false} />
            </div>
        )}

        {/* Batch Dashboard */}
        {batchItems.length > 0 && !selectedItem && (
            <BatchDashboard 
                items={batchItems}
                onViewDetails={setSelectedItemId}
                onReset={handleReset}
            />
        )}

        {/* Individual Result View */}
        {selectedItem && selectedItem.result && (
            <ResultDashboard 
                result={selectedItem.result} 
                originalFileName={selectedItem.file.name}
                file={selectedItem.file}
                onReset={handleReset}
                onBack={() => setSelectedItemId(null)}
            />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-slate-500">
            <p>&copy; {new Date().getFullYear()} AI Smart Grader. All rights reserved.</p>
            <div className="flex gap-6">
                <span className="hover:text-primary cursor-pointer">Privacy Policy</span>
                <span className="hover:text-primary cursor-pointer">Terms of Service</span>
            </div>
        </div>
      </footer>
    </div>
  );
};

export default App;