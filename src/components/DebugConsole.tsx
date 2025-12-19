import { useState, useEffect } from 'react';
import { Bug, X, Trash2 } from 'lucide-react';

const DebugConsole = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const originalLog = console.log;
    
    console.log = (...args: unknown[]) => {
      originalLog(...args);
      const message = args.map(a => 
        typeof a === 'object' ? JSON.stringify(a) : String(a)
      ).join(' ');
      
      // Filtrer uniquement les logs DEBUG
      if (message.includes('[DEBUG')) {
        setLogs(prev => [
          ...prev.slice(-30), 
          `${new Date().toISOString().slice(11, 19)} ${message}`
        ]);
      }
    };

    return () => {
      console.log = originalLog;
    };
  }, []);

  const clearLogs = () => setLogs([]);

  return (
    <div className="fixed bottom-4 right-4 z-[9999]">
      <button 
        onClick={() => setVisible(!visible)}
        className="bg-primary text-primary-foreground p-2 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
        title="Toggle Debug Console"
      >
        <Bug size={20} />
      </button>
      
      {visible && (
        <div className="absolute bottom-12 right-0 bg-black/95 text-green-400 text-xs p-3 rounded-lg shadow-xl w-80 max-h-72 overflow-hidden flex flex-col">
          <div className="flex justify-between items-center mb-2 pb-2 border-b border-green-400/30">
            <span className="font-bold text-green-300">Debug Console</span>
            <div className="flex gap-2">
              <button 
                onClick={clearLogs}
                className="text-yellow-400 hover:text-yellow-300"
                title="Clear logs"
              >
                <Trash2 size={14} />
              </button>
              <button 
                onClick={() => setVisible(false)}
                className="text-red-400 hover:text-red-300"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          
          <div className="overflow-auto flex-1 font-mono">
            {logs.length === 0 ? (
              <div className="text-gray-500 italic">Aucun log DEBUG...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="py-0.5 border-b border-green-400/10 break-words">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugConsole;
