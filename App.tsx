import React, { useState, useEffect, useRef } from 'react';
import { GradingResult, BatchItem, AIProvider, AIConfig, InstructorSettings } from './types';
import FileUpload from './components/FileUpload';
import ResultDashboard from './components/ResultDashboard';
import BatchDashboard from './components/BatchDashboard';
import { extractTextFromFile } from './services/fileService';
import { gradeDocument } from './services/geminiService';
import { GraduationCap, Settings, Bot, Network, Key, Server, Cpu, PenTool, Image as ImageIcon, Type, Feather } from 'lucide-react';

// Number of files to process simultaneously
const CONCURRENT_LIMIT = 3;

const App: React.FC = () => {
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isQueueProcessing, setIsQueueProcessing] = useState(false);
  
  // Grading Settings
  const [minScore, setMinScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(100);

  // Instructor Settings
  const [instructorEnabled, setInstructorEnabled] = useState<boolean>(false);
  const [instructorMode, setInstructorMode] = useState<'text' | 'image'>('text');
  const [instructorName, setInstructorName] = useState<string>('AI Grader');
  const [instructorFont, setInstructorFont] = useState<'standard' | 'artistic'>('standard');
  const [instructorImage, setInstructorImage] = useState<string>('');

  // AI Settings State
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [apiKey, setApiKey] = useState<string>('');
  
  // Advanced settings (Hidden for standard providers)
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [proxyUrl, setProxyUrl] = useState<string>(''); 

  // Pre-fill defaults
  useEffect(() => {
      if (aiProvider === 'gemini') {
          setBaseUrl('');
          setModelName('gemini-2.5-flash');
          setProxyUrl('');
      } else if (aiProvider === 'doubao') {
          setBaseUrl('https://ark.cn-beijing.volces.com/api/v3');
          setModelName('ep-20250212093506-69677'); 
          setProxyUrl('https://corsproxy.io/?'); 
      } else if (aiProvider === 'deepseek') {
          setBaseUrl('https://api.deepseek.com');
          setModelName('deepseek-chat');
          setProxyUrl('https://corsproxy.io/?');
      } else if (aiProvider === 'kimi') {
          setBaseUrl('https://api.moonshot.cn/v1');
          setModelName('moonshot-v1-8k');
          setProxyUrl('https://corsproxy.io/?');
      } else if (aiProvider === 'openai') {
          setBaseUrl('https://api.openai.com/v1');
          setModelName('gpt-4o');
          setProxyUrl('https://corsproxy.io/?');
      } else {
          setBaseUrl('');
          setModelName('');
          setProxyUrl('');
      }
  }, [aiProvider]);

  const handleFileSelect = (files: File[]) => {
    const newItems: BatchItem[] = files.map(file => ({
        id: Math.random().toString(36).substring(7),
        file: file,
        status: 'queued'
    }));
    
    setBatchItems(newItems);
    setIsQueueProcessing(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setInstructorImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper to process a single item
  const processItem = async (item: BatchItem, currentConfig: any) => {
        try {
            // 1. Extract Text
            const textContent = await extractTextFromFile(item.file);
            
            if (!textContent || textContent.trim().length < 50) {
                throw new Error("Document is empty or contains no readable text.");
            }

            // 2. Prepare AI Config
            const aiConfig: AIConfig = {
                provider: currentConfig.aiProvider,
                apiKey: currentConfig.apiKey.trim(),
                baseUrl: currentConfig.baseUrl.trim(),
                modelName: currentConfig.modelName.trim(),
                proxyUrl: currentConfig.proxyUrl.trim()
            };
            
            // 3. Grade
            const result = await gradeDocument(textContent, { 
                minScore: currentConfig.minScore, 
                maxScore: currentConfig.maxScore, 
                aiConfig 
            });
            
            // Update success
            setBatchItems(prev => prev.map(i => 
                i.id === item.id ? { ...i, status: 'completed', result } : i
            ));

        } catch (err: any) {
            console.error("Error processing file", item.file.name, err);
            
            let errorMessage = "Unknown Error";
            if (typeof err === 'string') errorMessage = err;
            else if (err instanceof Error) errorMessage = err.message;
            else if (err && typeof err === 'object' && err.message) errorMessage = String(err.message);
            
            // Update error state
            setBatchItems(prev => prev.map(i => 
                i.id === item.id ? { ...i, status: 'error', error: errorMessage } : i
            ));
        }
  };

  // Concurrent Queue Processing Effect
  useEffect(() => {
    if (!isQueueProcessing) return;

    const queuedItems = batchItems.filter(i => i.status === 'queued');
    const processingItems = batchItems.filter(i => i.status === 'processing');
    
    // Check if we are done
    if (queuedItems.length === 0 && processingItems.length === 0) {
        setIsQueueProcessing(false);
        return;
    }

    // Calculate slots
    const slotsAvailable = CONCURRENT_LIMIT - processingItems.length;

    if (slotsAvailable > 0 && queuedItems.length > 0) {
        const toProcess = queuedItems.slice(0, slotsAvailable);

        // 1. Mark as processing synchronously to block other effects from picking them up
        setBatchItems(prev => prev.map(i => 
            toProcess.find(t => t.id === i.id) ? { ...i, status: 'processing', error: undefined } : i
        ));

        // 2. Launch async tasks
        // We pass the current config values to the function
        const configSnapshot = {
            aiProvider, apiKey, baseUrl, modelName, proxyUrl, minScore, maxScore
        };

        toProcess.forEach(item => {
            processItem(item, configSnapshot);
        });
    }

  }, [batchItems, isQueueProcessing, aiProvider, apiKey, baseUrl, modelName, proxyUrl, minScore, maxScore]);


  const handleReset = () => {
    setBatchItems([]);
    setSelectedItemId(null);
    setIsQueueProcessing(false);
  };

  const handleRetry = (id: string) => {
    setBatchItems(prev => prev.map(item => {
        if (item.id === id) {
            return { ...item, status: 'queued', error: undefined, result: undefined };
        }
        return item;
    }));
    setIsQueueProcessing(true);
  };

  const getInstructorSettings = (): InstructorSettings => ({
      enabled: instructorEnabled,
      mode: instructorMode,
      name: instructorName,
      fontStyle: instructorFont,
      imageData: instructorImage
  });

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
             AI Model: <span className="text-primary font-bold uppercase">{aiProvider}</span>
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
                    Upload documents to grade automatically. Configure grading and signature options below.
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
                    
                    {/* Top Row: Score & Provider */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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

                        <div>
                             <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                AI Provider
                            </label>
                            <select 
                                value={aiProvider}
                                onChange={(e) => setAiProvider(e.target.value as AIProvider)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium text-slate-700"
                            >
                                <option value="gemini">Google Gemini (Free/Built-in)</option>
                                <option value="doubao">Volcengine Doubao (Pro)</option>
                                <option value="deepseek">DeepSeek-V3</option>
                                <option value="kimi">Moonshot Kimi</option>
                                <option value="openai">ChatGPT-4o</option>
                                <option value="custom">Custom OpenAI API</option>
                            </select>
                        </div>
                    </div>

                    {/* Instructor / Signature Settings */}
                    <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 mb-6 animate-fadeIn">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3">
                            <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <PenTool className="w-4 h-4" />
                                Instructor Signature
                            </h4>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={instructorEnabled} 
                                    onChange={(e) => setInstructorEnabled(e.target.checked)} 
                                    className="sr-only peer" 
                                />
                                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                <span className="ml-2 text-xs font-medium text-slate-600">
                                    {instructorEnabled ? 'On' : 'Off'}
                                </span>
                            </label>
                        </div>

                        {instructorEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fadeIn">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                        Signature Mode
                                    </label>
                                    <div className="flex gap-2 bg-white rounded-lg p-1 border border-slate-200">
                                        <button
                                            onClick={() => setInstructorMode('text')}
                                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-medium rounded transition-all ${
                                                instructorMode === 'text' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            <Type className="w-3 h-3" /> Text
                                        </button>
                                        <button
                                            onClick={() => setInstructorMode('image')}
                                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-medium rounded transition-all ${
                                                instructorMode === 'image' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            <ImageIcon className="w-3 h-3" /> Image
                                        </button>
                                    </div>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                        {instructorMode === 'text' ? 'Instructor Name' : 'Upload Signature Image'}
                                    </label>
                                    {instructorMode === 'text' ? (
                                        <div className="flex gap-2">
                                            <input 
                                                type="text" 
                                                value={instructorName}
                                                onChange={(e) => setInstructorName(e.target.value)}
                                                className={`flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm transition-all ${instructorFont === 'artistic' ? 'font-artistic text-xl' : ''}`}
                                                placeholder="e.g. Professor Smith"
                                            />
                                            {/* Font Style Toggle */}
                                            <div className="flex bg-white rounded-lg border border-slate-200 p-1">
                                                <button 
                                                    onClick={() => setInstructorFont('standard')}
                                                    className={`p-2 rounded hover:bg-slate-50 ${instructorFont === 'standard' ? 'bg-slate-100 text-primary' : 'text-slate-400'}`}
                                                    title="Standard Font"
                                                >
                                                    <Type className="w-4 h-4" />
                                                </button>
                                                <button 
                                                    onClick={() => setInstructorFont('artistic')}
                                                    className={`p-2 rounded hover:bg-slate-50 ${instructorFont === 'artistic' ? 'bg-slate-100 text-primary' : 'text-slate-400'}`}
                                                    title="Artistic/Handwriting Font"
                                                >
                                                    <Feather className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-4">
                                            <input 
                                                type="file" 
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                                className="block w-full text-sm text-slate-500
                                                    file:mr-4 file:py-2 file:px-4
                                                    file:rounded-full file:border-0
                                                    file:text-xs file:font-semibold
                                                    file:bg-indigo-50 file:text-indigo-700
                                                    hover:file:bg-indigo-100"
                                            />
                                            {instructorImage && (
                                                <div className="h-10 w-10 relative shrink-0">
                                                    <img src={instructorImage} alt="Signature Preview" className="h-full w-full object-contain rounded border border-slate-200 bg-white" />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Dynamic AI Settings */}
                    {aiProvider !== 'gemini' && (
                        <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 space-y-4 animate-fadeIn">
                            <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 border-b border-slate-200 pb-2">
                                <Cpu className="w-4 h-4" />
                                {aiProvider.charAt(0).toUpperCase() + aiProvider.slice(1)} Settings
                            </h4>
                            
                            {/* API Key Input (Always Visible) */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                    <Key className="w-3 h-3" /> API Key <span className="text-red-400">*</span>
                                </label>
                                <input 
                                    type="password" 
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                    placeholder={`Enter your ${aiProvider} API Key`}
                                />
                            </div>

                            {/* HIDDEN / AUTO-CONFIGURED FIELDS */}
                            {(aiProvider === 'custom' || aiProvider === 'doubao') && (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                        <Bot className="w-3 h-3" /> {aiProvider === 'doubao' ? 'Endpoint ID (Model)' : 'Model Name'}
                                    </label>
                                    <input 
                                        type="text" 
                                        value={modelName}
                                        onChange={(e) => setModelName(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                        placeholder={aiProvider === 'doubao' ? "ep-2025..." : "gpt-4o"}
                                    />
                                    {aiProvider === 'doubao' && <p className="text-xs text-slate-400 mt-1">Check your Volcengine console for the Endpoint ID (e.g., ep-2025...)</p>}
                                </div>
                            )}

                            {aiProvider === 'custom' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                            <Server className="w-3 h-3" /> Base URL
                                        </label>
                                        <input 
                                            type="text" 
                                            value={baseUrl}
                                            onChange={(e) => setBaseUrl(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                            placeholder="https://api.example.com/v1"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                            <Network className="w-3 h-3" /> CORS Proxy
                                        </label>
                                        <input 
                                            type="text" 
                                            value={proxyUrl}
                                            onChange={(e) => setProxyUrl(e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                                            placeholder="Optional: https://corsproxy.io/?"
                                        />
                                    </div>
                                </>
                            )}
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
                instructorSettings={getInstructorSettings()}
                onViewDetails={setSelectedItemId}
                onReset={handleReset}
                onRetry={handleRetry}
            />
        )}

        {/* Individual Result View */}
        {selectedItem && selectedItem.result && (
            <ResultDashboard 
                result={selectedItem.result} 
                originalFileName={selectedItem.file.name}
                file={selectedItem.file}
                instructorSettings={getInstructorSettings()}
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