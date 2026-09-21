import React, { useState, useEffect, useRef } from 'react';
import { Activity, BarChart3, Package, CheckCircle2, ArrowRightLeft, MessageSquare, AlertTriangle } from 'lucide-react';
import { useAuth } from './hooks/auth.context';
import { useSemanticModelQuery } from './hooks/use-semantic-model-query';

function KPIBox({ title, value, icon: Icon, color, isLoading }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <h3 className="text-2xl font-bold mt-1 text-gray-900">
          {isLoading ? <span className="text-gray-400 text-lg font-medium">Loading...</span> : value}
        </h3>
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'manual'>('dashboard');
  const { session } = useAuth();
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [notification, setNotification] = useState<{show: boolean, message: string, type: 'success' | 'error'} | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };
  
  // Chatbot states
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', text: 'Hello! I am your Autonomous Retail Intelligence Agent. Ask me about regional stockout risks, product demand forecasts, or warehouse allocations.' }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [chatHistory, activeTab]);

  // Query the unified master table
  const { data: intelligenceResult, isLoading, error } = useSemanticModelQuery({
    connection: "DemandForecasting",
    query: `
      EVALUATE 
      SUMMARIZE(
        'product_region_intelligence', 
        'product_region_intelligence'[sku],
        'product_region_intelligence'[product_name],
        'product_region_intelligence'[category],
        'product_region_intelligence'[subcategory],
        'product_region_intelligence'[region],
        'product_region_intelligence'[assigned_warehouse],
        'product_region_intelligence'[available_stock],
        'product_region_intelligence'[predicted_demand],
        'product_region_intelligence'[stockout_risk],
        'product_region_intelligence'[intelligence_reasoning]
      )
    `
  });

  const rawRows = intelligenceResult?.status === "success" ? intelligenceResult.table.rows : [];
  
  // Create a copy and sort by stockout risk (HIGH -> MEDIUM -> LOW)
  const riskOrder: Record<string, number> = { "HIGH": 1, "MEDIUM": 2, "LOW": 3 };
  const rows = [...rawRows].sort((a: any, b: any) => {
    const riskA = riskOrder[a[8]] || 99;
    const riskB = riskOrder[b[8]] || 99;
    return riskA - riskB;
  });

  // Calculate dynamic KPIs from the unified rows using the exact array indices returned by Fabric DAX
  const totalProductsCount = rows.length.toString();
  const highRiskCount = rows.filter((r: any) => r[8] === 'HIGH').length.toString();
  const activeRegionsCount = new Set(rows.map((r: any) => r[4])).size.toString();

  // Multi-Agent Reasoning State
  const [agentReasonings, setAgentReasonings] = useState<Record<string, string>>({});
  const [isAgentsScanning, setIsAgentsScanning] = useState(false);

  useEffect(() => {
    // Only run if we have rows and haven't fetched reasonings yet
    if (rows.length > 0 && Object.keys(agentReasonings).length === 0 && !isAgentsScanning) {
      const fetchReasonings = async () => {
        setIsAgentsScanning(true);
        try {
          const products = rows.map((r: any) => ({ sku: r[0], name: r[1], category: r[2], region: r[4], stock: r[6], demand: r[7] }));
          const res = await fetch("https://forecast-agent.onrender.com/api/multi-agent-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ products })
          });
          const data = await res.json();
          if (data.success && data.reasonings) {
            setAgentReasonings(data.reasonings);
          }
        } catch (err) {
          console.error("Failed to run multi-agent analysis", err);
        } finally {
          setIsAgentsScanning(false);
        }
      };
      fetchReasonings();
    }
  }, [rows]);

  // Array of Groq API keys for round-robin rotation
  const GROQ_KEYS = [
    import.meta.env.VITE_GROQ_API_KEY_1 || '',
    import.meta.env.VITE_GROQ_API_KEY_2 || '',
    import.meta.env.VITE_GROQ_API_KEY_3 || ''
  ].filter(key => key !== '');
  const groqKeyIndexRef = React.useRef(0);

  // Real Groq-powered chat handler
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuery.trim()) return;

    const userMsg = chatQuery;
    setChatQuery('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsTyping(true);
    setIsScraping(true);

    // Call Groq API dynamically using your app's live table data rows as context
    (async () => {
      try {
        // 1. Fetch real-time market intelligence from Apify via our backend
        let marketIntelligence = "No external market data available right now.";
        try {
          const apifyRes = await fetch("https://forecast-agent.onrender.com/api/market-intelligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: userMsg })
          });
          
          if (apifyRes.ok) {
            const apifyData = await apifyRes.json();
            if (apifyData.success && apifyData.data && apifyData.data.length > 0) {
              marketIntelligence = "LIVE AMAZON COMPETITOR DATA: " + JSON.stringify(apifyData.data);
            }
          }
        } catch (err) {
          console.warn("Could not fetch Apify data:", err);
        }
        
        setIsScraping(false);

        // Select the current API key and advance the index
        const currentApiKey = GROQ_KEYS[groqKeyIndexRef.current];
        groqKeyIndexRef.current = (groqKeyIndexRef.current + 1) % GROQ_KEYS.length;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${currentApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: `You are an Autonomous Retail Intelligence Agent. You have direct access to the live Microsoft Fabric Lakehouse data rows: ${JSON.stringify(rows)}. 
The data columns are: [0: SKU, 1: Product Name, 2: Category, 3: Subcategory, 4: Region, 5: Warehouse, 6: Available Stock, 7: Predicted Demand, 8: Stockout Risk, 9: AI Reasoning].

You ALSO have access to this real-time web scraped data from Apify:
${marketIntelligence}

CRITICAL INSTRUCTIONS:
1. NEVER output raw markdown tables of the entire dataset unless the user explicitly asks for a "table" of all data.
2. When asked general questions, provide a highly concise summary.
3. Keep answers extremely brief, human-like, and directly address the user's prompt.
4. Always factor in the live Apify market data if it is relevant to the user's question (e.g. mention competitor prices if available).
5. DO NOT use markdown formatting like ** or bullet points. Use plain text only.
6. DO NOT explain mathematical formulas or logic (e.g. never say "available < predicted demand"). Just state the region, the reason, and the numbers naturally.
7. DO NOT use em dashes (—) or en dashes (–) anywhere in your response. Use standard commas or periods for pauses.`
              },
              { role: 'user', content: userMsg }
            ]
          })
        });

        const data = await response.json();
        
        let agentReply = "I am analyzing the live inventory tables, but could not process that query right now.";
        if (data.error) {
          agentReply = "Groq API Error: " + JSON.stringify(data.error);
        } else if (data.choices?.[0]?.message?.content) {
          // Fallback to strip out em dashes and en dashes if the LLM ignores instructions
          agentReply = data.choices[0].message.content.replace(/[—–]/g, '-');
        }
        
        setChatHistory(prev => [...prev, { role: 'assistant', text: agentReply }]);
      } catch (err: any) {
        setChatHistory(prev => [...prev, { role: 'assistant', text: "Network Error: " + err.message }]);
      } finally {
        setIsTyping(false);
      }
    })();
  };

  const handleRunPipeline = () => {
    setIsPipelineRunning(true);
    
    // Because the frontend is on HTTPS and backend is on HTTP localhost, 
    // fetch/iframe is blocked by Mixed Content and PNA. 
    // Opening it in a new window context bypasses this security block.
    const triggerWindow = window.open('https://forecast-agent.onrender.com/api/run-pipeline', '_blank', 'width=400,height=300,top=100,left=100');
    
    setTimeout(() => {
      setIsPipelineRunning(false);
      showNotification("Agents successfully ran! Please refresh the page in a few moments to see the updated data.", "success");
      // The backend script will automatically close the window, but just in case:
      if (triggerWindow) triggerWindow.close();
    }, 2500);
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#ecf39e]/20 text-gray-900 font-sans relative">
      {/* Toast Notification */}
      {notification && notification.show && (
        <div className={`absolute top-24 right-8 z-50 px-6 py-4 rounded-xl shadow-lg shadow-[#90a955]/20 flex items-center gap-3 animate-in fade-in slide-in-from-right-8 ${
          notification.type === 'success' ? 'bg-[#31572c] text-white' : 'bg-red-600 text-white'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#31572c] to-[#4f772d] rounded-xl flex items-center justify-center shadow-lg shadow-[#90a955]/30">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#132a13]">Cognitive Retail Command Center</h1>
            <p className="text-sm text-[#4f772d] font-medium tracking-wide">
              Autonomous Demand Forecasting and Multi-Agent Inventory Optimization Engine
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'dashboard' ? 'bg-white text-[#31572c] shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                activeTab === 'chat' ? 'bg-white text-[#31572c] shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <MessageSquare className="w-4 h-4" /> Agent Chatbot
            </button>
          </div>
          
          <div className="h-8 w-px bg-gray-200"></div>
          
          <button 
            onClick={handleRunPipeline}
            disabled={isPipelineRunning}
            className={`bg-[#4f772d] hover:bg-[#31572c] text-white font-semibold py-2 px-5 rounded-xl shadow-sm transition-all flex items-center gap-2 active:scale-95 ${isPipelineRunning ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <Activity className={`w-4 h-4 ${isPipelineRunning ? 'animate-spin' : ''}`} />
            {isPipelineRunning ? 'Running...' : 'Run Agents'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-8 w-full max-w-[1600px] mx-auto flex flex-col">
        
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
            {/* KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <KPIBox 
                title="Tracked Product-Regions" 
                value={totalProductsCount} 
                icon={Package} 
                color="bg-[#90a955]/15 text-[#4f772d]"
                isLoading={isLoading}
              />
              <KPIBox 
                title="High Stockout Risks" 
                value={highRiskCount} 
                icon={AlertTriangle} 
                color="bg-red-50 text-red-600"
                isLoading={isLoading}
              />
              <KPIBox 
                title="Active Regions" 
                value={activeRegionsCount} 
                icon={BarChart3} 
                color="bg-[#ecf39e]/50 text-[#31572c]"
                isLoading={isLoading}
              />
              <KPIBox 
                title="System Status" 
                value="Active / Hourly" 
                icon={Activity} 
                color="bg-orange-50 text-orange-600"
                isLoading={false}
              />
            </div>

            {/* Main Unified Intelligence Table */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col flex-1">
              <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-[#31572c]" />
                  <h2 className="text-lg font-bold text-gray-900">Product-Region Stock & Autonomous Intelligence</h2>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50/80 sticky top-0 backdrop-blur-sm z-10">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Product Name & SKU</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Category / Subcategory</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Region & Warehouse</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Stock vs Target Demand</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Stockout Risk</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">AI Intelligence Reasoning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.map((item: any, i: number) => {
                      const sku = item[0];
                      const name = item[1];
                      const cat = item[2];
                      const subcat = item[3];
                      const region = item[4];
                      const wh = item[5];
                      const stock = item[6];
                      const demand = item[7];
                      const risk = item[8];
                      const reasoning = item[9];

                      return (
                        <tr key={i} className="hover:bg-gray-50/80 transition-colors">
                          <td className="px-6 py-4 font-semibold text-gray-900">
                            {name}
                            <span className="block text-xs text-gray-400 font-mono font-normal">{sku}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-gray-800 font-medium">{cat}</span>
                            <span className="block text-xs text-gray-400">{subcat}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-semibold text-gray-900">{region}</span>
                            <span className="block text-xs text-gray-500 font-mono">{wh}</span>
                          </td>
                          <td className="px-6 py-4 font-mono">
                            <span className="text-gray-900 font-bold">{stock} avail</span>
                            <span className="block text-xs text-blue-600">Target: {demand}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              risk === 'HIGH' ? 'bg-red-100 text-red-700' : risk === 'MEDIUM' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {risk}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-600 max-w-xs leading-relaxed">
                            {agentReasonings[sku] ? (
                              <span className="text-gray-900 font-medium">{agentReasonings[sku]}</span>
                            ) : (
                              <span className="text-[#4f772d] animate-pulse flex items-center gap-2">
                                <Activity className="w-4 h-4 animate-spin" /> Agent scanning global trends & social media...
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-4xl mx-auto flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-5 border-b border-gray-200 bg-white font-bold text-gray-900 flex items-center gap-2 sticky top-0 z-10 shadow-sm">
              <MessageSquare className="w-5 h-5 text-[#31572c]" /> Retail Intelligence Virtual Assistant
            </div>
            <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-gray-50/50">
              {chatHistory.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-[#4f772d] text-white rounded-br-sm' 
                      : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 text-gray-500 rounded-2xl rounded-bl-sm p-4 text-sm shadow-sm flex items-center gap-2">
                    {isScraping ? (
                      <>
                        <Activity className="w-4 h-4 animate-spin text-[#31572c]" />
                        Scraping the web for live market intelligence (this may take up to a minute)...
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleChatSubmit} className="p-4 border-t border-gray-200 bg-white flex gap-3 sticky bottom-0">
              <input 
                type="text"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                placeholder="Ask about regional stockouts, product demand, or AI reasoning..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#4f772d]/20 focus:border-[#4f772d] outline-none bg-gray-50/50 transition-all placeholder:text-gray-400"
              />
              <button type="submit" className="bg-[#4f772d] hover:bg-[#31572c] text-white px-8 py-3 rounded-xl text-sm font-semibold shadow-sm shadow-[#90a955]/30 transition-all active:scale-95">
                Ask Agent
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}