import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Plus, Trash2, Clock, User, Mail, Settings, Loader2,
  AlertCircle, X, CheckCircle2, RefreshCw, Search, Terminal,
  WifiOff, Filter, FileText, AlertTriangle, Moon, Sun, ChevronRight
} from 'lucide-react';

// --- HELPERS ---
/**
 * Retorna RFC3339 com offset local (ex: 2026-02-19T17:00:00-04:00)
 * Garante que a data enviada ao n8n preserve o fuso horário de Roraima.
 */
function toRFC3339WithLocalOffset(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const tzOffsetMin = date.getTimezoneOffset();
  const sign = tzOffsetMin > 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offH}:${offM}`;
}

export default function App() {
  const WEBHOOK_URL = "https://n8n-ouvidoria.tjrr.jus.br/webhook/calendar-api";
  
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState(''); 
  const [debugLog, setDebugLog] = useState([]);
  const [viewRange, setViewRange] = useState(7);
  const [conflictDetails, setConflictDetails] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, eventId: null, eventTitle: '' });

  const TIME_SLOTS = Array.from({ length: 19 }, (_, i) => {
    const h = Math.floor(i / 2) + 8;
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });

  const [formData, setFormData] = useState({ 
    nome: '', 
    email: '', 
    assunto: '', 
    data: new Date().toISOString().split('T')[0], 
    horaInicio: '08:00' 
  });

  const addLog = useCallback((msg, type = 'info') => {
    const messageString = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    setDebugLog(prev => [{ 
      timestamp: new Date().toLocaleTimeString(), 
      msg: messageString, 
      type 
    }, ...prev].slice(0, 10));
  }, []);

  const showToast = useCallback((message, type = 'success') => { 
    setToast({ message: String(message), type }); 
    setTimeout(() => setToast(null), 5000); 
  }, []);

  const callN8N = useCallback(async (action, payload = {}) => {
    setLoading(true);
    setConflictDetails(null);
    addLog(`Chamada API: ${action}...`);
    try {
      const res = await fetch(WEBHOOK_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        mode: 'cors', 
        body: JSON.stringify({ action, ...payload }) 
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) { 
          setConflictDetails(data?.conflicts || []); 
          throw new Error("Conflito: Horário ocupado."); 
        }
        throw new Error(data?.error || `Erro HTTP ${res.status}`);
      }
      addLog(`${action.toUpperCase()} Sucesso`, 'success');
      return data;
    } catch (err) { 
      addLog(err.message, 'error'); 
      showToast(err.message, "error"); 
      return null; 
    } finally { 
      setLoading(false); 
    }
  }, [addLog, showToast]);

  const fetchEvents = useCallback(async () => {
    const now = new Date();
    const listStart = toRFC3339WithLocalOffset(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
    const listEnd = toRFC3339WithLocalOffset(new Date(now.getTime() + (viewRange * 24 * 60 * 60 * 1000)));
    
    const data = await callN8N('list', { listStart, listEnd });
    if (data && data.data) {
      setEvents(data.data);
    } else if (Array.isArray(data)) {
      setEvents(data);
    }
  }, [viewRange, callN8N]);

  // Atualização em tempo real (Polling)
  useEffect(() => { 
    fetchEvents(); 
    const interval = setInterval(fetchEvents, 60000); 
    return () => clearInterval(interval); 
  }, [fetchEvents]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const start = new Date(`${formData.data}T${formData.horaInicio}:00`);
    const end = new Date(start.getTime() + 120 * 60000); // 2 Horas fixas
    
    const result = await callN8N('create', { 
      nome: formData.nome, 
      email: formData.email, 
      assunto: formData.assunto, 
      inicio: toRFC3339WithLocalOffset(start), 
      fim: toRFC3339WithLocalOffset(end) 
    });
    
    if (result) { 
      showToast("Agendamento criado!"); 
      setIsModalOpen(false); 
      setFormData({ 
        nome: '', email: '', assunto: '', 
        data: new Date().toISOString().split('T')[0], 
        horaInicio: '08:00' 
      });
      // Forçar atualização imediata após criar
      await fetchEvents();
      setTimeout(fetchEvents, 2000); // Reforço para garantir sincronia do Google
    }
  };

  const handleDelete = async (eventId) => {
    const result = await callN8N('delete', { eventId });
    if (result) { 
      showToast("Agendamento eliminado."); 
      setDeleteConfirm({ isOpen: false, eventId: null, eventTitle: '' }); 
      await fetchEvents(); 
    }
  };

  const formatSafeDate = (startObj, endObj) => {
    const s = startObj?.dateTime || startObj?.date || startObj;
    const e = endObj?.dateTime || endObj?.date || endObj;
    const d1 = new Date(s);
    const d2 = new Date(e);
    if (isNaN(d1.getTime())) return "Evento de Dia Inteiro";
    return `${d1.toLocaleDateString('pt-PT')} ${d1.toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'})} - ${d2.toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'})}`;
  };

  const filteredEvents = events.filter(e => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = e.summary?.toLowerCase().includes(search) || e.attendees?.[0]?.email?.toLowerCase().includes(search);
    const eventDate = e.start?.dateTime?.split('T')[0] || e.start?.date;
    return matchesSearch && (!dateFilter || eventDate === dateFilter);
  });

  return (
    <div className={`min-h-screen transition-colors duration-300 font-sans p-3 sm:p-4 md:p-8 ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* HEADER PREMIUM */}
      <header className="max-w-6xl mx-auto mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className={`p-4 sm:p-7 rounded-[2rem] sm:rounded-[3.5rem] shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 border transition-all ${darkMode ? 'bg-slate-900 border-slate-800 shadow-black/40' : 'bg-white border-white shadow-slate-200/40'}`}>
          <div className="flex items-center gap-4 sm:gap-6 w-full md:w-auto">
            <div className="bg-indigo-600 p-3 sm:p-4 rounded-[1.5rem] shadow-xl shadow-indigo-500/20 ring-8 ring-indigo-500/10">
              <Calendar className="text-white w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div>
              <h1 className="font-black text-2xl sm:text-3xl tracking-tight leading-none">Ouvidoria</h1>
              <p className="text-xs sm:text-sm font-bold text-indigo-500 uppercase tracking-widest mt-1.5 opacity-80">Tribunal de Justiça - RR</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 sm:gap-4 w-full md:w-auto">
            <div className={`flex p-1.5 rounded-2xl border transition-all ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
              {[7, 15, 31].map(d => (
                <button 
                  key={d} 
                  onClick={() => setViewRange(d)} 
                  className={`px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-black rounded-xl transition-all ${viewRange === d ? (darkMode ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 shadow-md') : (darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700')}`}
                >
                  {d}D
                </button>
              ))}
            </div>
            <button 
              onClick={() => setIsConfigOpen(!isConfigOpen)} 
              className={`p-3 sm:p-4 rounded-2xl transition-all border ${isConfigOpen ? (darkMode ? 'bg-indigo-900/40 text-indigo-400 border-indigo-800' : 'bg-indigo-50 text-indigo-600 border-indigo-200') : (darkMode ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-white text-slate-400 border-slate-200')}`}
            >
              <Settings className={`w-5 h-5 sm:w-6 sm:h-6 ${loading && isConfigOpen ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={() => setIsModalOpen(true)} 
              className="bg-indigo-600 text-white px-6 sm:px-10 py-3 sm:py-4 rounded-2xl sm:rounded-3xl font-black text-sm sm:text-base shadow-2xl shadow-indigo-500/30 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-3 uppercase tracking-tighter"
            >
              <Plus className="w-5 h-5 sm:w-6 sm:h-6" /> Novo
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8 pb-20">
        
        {/* FERRAMENTAS DO SISTEMA (MODO ESCURO E LOGS) */}
        {isConfigOpen && (
          <div className={`border rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-300 transition-all ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between mb-6 border-b transition-all border-slate-100 dark:border-slate-800 pb-6">
              <h3 className="flex items-center gap-3 font-black text-sm sm:text-base uppercase tracking-widest">
                <Terminal className="w-5 h-5 text-indigo-500" /> Definições
              </h3>
              <button 
                onClick={() => setDarkMode(!darkMode)}
                className={`flex items-center gap-3 px-6 py-3 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-widest transition-all ${darkMode ? 'bg-slate-800 text-yellow-400 border border-slate-700' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {darkMode ? 'Visual Claro' : 'Visual Escuro'}
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Registo de Transações</p>
              <div className="bg-slate-950 rounded-3xl p-5 font-mono text-xs sm:text-sm text-indigo-400/90 shadow-inner h-40 overflow-y-auto border border-slate-800 leading-relaxed">
                {debugLog.length === 0 && <p className="text-slate-700 italic">A aguardar atividade...</p>}
                {debugLog.map((log, i) => (
                  <div key={i} className="mb-1 border-b border-slate-900/50 pb-1">
                    <span className="text-slate-600 font-bold">[{log.timestamp}]</span>{' '}
                    <span className={log.type === 'error' ? 'text-red-400 font-bold' : log.type === 'success' ? 'text-emerald-400' : 'text-indigo-300'}>
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ALERTA DE CONFLITO */}
        {conflictDetails && (
          <div className="bg-red-500/10 border-2 border-red-500/20 rounded-[2.5rem] p-6 sm:p-8 shadow-xl animate-in slide-in-from-top-2 duration-500">
            <div className="flex items-center gap-3 text-red-500 mb-6 font-black uppercase text-sm tracking-[0.2em]">
              <AlertTriangle className="w-6 h-6 animate-pulse" /> Atenção: Horário Bloqueado
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {conflictDetails.map((c, i) => (
                <div key={i} className={`p-5 rounded-3xl border shadow-sm transition-all flex flex-col justify-center ${darkMode ? 'bg-slate-900 border-red-900/40' : 'bg-white border-red-100'}`}>
                  <p className="font-black text-lg text-slate-800 dark:text-slate-100 truncate">{c.summary || "(Evento Fantasma)"}</p>
                  <p className="text-xs sm:text-sm text-red-500 font-bold uppercase mt-2 tracking-tight opacity-80">{formatSafeDate(c.start, c.end)}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setConflictDetails(null)} className="mt-6 text-xs sm:text-sm font-black text-red-500 hover:underline uppercase tracking-widest px-4">Ignorar e fechar</button>
          </div>
        )}

        {/* FILTROS E BUSCA */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 group">
            <Search className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors w-6 h-6 ${darkMode ? 'text-slate-600 group-focus-within:text-indigo-400' : 'text-slate-300 group-focus-within:text-indigo-500'}`} />
            <input 
              placeholder="Pesquisar por solicitante ou assunto..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              className={`w-full pl-14 pr-6 py-4 sm:py-5 border rounded-[1.5rem] sm:rounded-[2.5rem] outline-none focus:ring-8 transition-all text-sm sm:text-base font-bold ${darkMode ? 'bg-slate-900 border-slate-800 text-white focus:ring-indigo-900/20' : 'bg-white border-slate-200 focus:ring-indigo-50 shadow-xl shadow-slate-200/20'}`} 
            />
          </div>
          <div className="relative group">
            <Filter className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors w-5 h-5 ${darkMode ? 'text-slate-600' : 'text-slate-300'}`} />
            <input 
              type="date" 
              value={dateFilter} 
              onChange={e => setDateFilter(e.target.value)} 
              className={`w-full sm:w-auto pl-14 pr-8 py-4 sm:py-5 border rounded-[1.5rem] sm:rounded-[2.5rem] outline-none focus:ring-8 transition-all text-sm sm:text-base font-black ${darkMode ? 'bg-slate-900 border-slate-800 text-white focus:ring-indigo-900/20' : 'bg-white border-slate-200 focus:ring-indigo-50 shadow-xl shadow-slate-200/20 text-slate-600 uppercase'}`} 
            />
          </div>
        </div>

        {/* CONTEÚDO PRINCIPAL */}
        {loading && events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-500">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-6" />
            <p className="text-sm sm:text-base font-black uppercase tracking-widest animate-pulse">A atualizar agenda...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-32 rounded-[3.5rem] border-4 border-dashed transition-all ${darkMode ? 'bg-slate-900/50 border-slate-800 text-slate-700' : 'bg-white/50 border-slate-100 text-slate-300 shadow-inner'}`}>
            <WifiOff className="w-20 h-20 mb-6 opacity-20" />
            <p className="font-black uppercase tracking-widest text-sm">Calendário Vazio</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 animate-in fade-in duration-500">
            {filteredEvents.map((event) => (
              <div key={event.id} className={`border rounded-[2.5rem] p-6 sm:p-8 hover:shadow-2xl transition-all border-l-[12px] border-l-indigo-600 flex flex-col justify-between min-h-[220px] relative overflow-hidden group ${darkMode ? 'bg-slate-900 border-slate-800 hover:shadow-black/60' : 'bg-white border-slate-100 hover:shadow-indigo-200/30'}`}>
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700"></div>
                
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-6">
                    <span className={`text-[10px] sm:text-xs font-black px-4 py-1.5 rounded-full uppercase tracking-widest border ${darkMode ? 'bg-indigo-900/30 text-indigo-400 border-indigo-900/50' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>Audiência</span>
                    <button onClick={() => setDeleteConfirm({ isOpen: true, eventId: event.id, eventTitle: event.summary })} className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all active:scale-90"><Trash2 className="w-5 h-5 sm:w-6 sm:h-6" /></button>
                  </div>
                  <h3 className="font-black text-lg sm:text-xl md:text-2xl mb-6 line-clamp-2 leading-tight tracking-tight text-slate-800 dark:text-slate-100">{event.summary}</h3>
                </div>
                
                <div className={`space-y-4 pt-6 border-t relative z-10 transition-all ${darkMode ? 'border-slate-800' : 'border-slate-50'}`}>
                  <div className="flex items-center gap-4 text-xs sm:text-sm font-black text-slate-600 dark:text-slate-400"><Clock className="w-5 h-5 text-indigo-500" /> {new Date(event.start?.dateTime || event.start?.date).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>
                  <div className={`flex items-center gap-4 text-xs sm:text-sm italic truncate font-bold ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Mail className="w-5 h-5 text-indigo-500/30" /> {event.attendees?.[0]?.email || 'Sem contacto'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* MODAL CRIAR (OTIMIZADO PARA TEXTO GRANDE E ECRÃS PEQUENOS) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-2 sm:p-6 overflow-y-auto">
          <div className={`rounded-[2.5rem] sm:rounded-[4rem] w-full max-w-xl shadow-2xl p-7 sm:p-14 animate-in zoom-in-95 duration-300 relative my-auto border transition-all ${darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-white shadow-indigo-200/50'}`}>
            <button onClick={() => setIsModalOpen(false)} className="absolute top-8 right-8 p-3 hover:bg-slate-800/10 rounded-full transition-colors"><X className="w-7 h-7 text-slate-400" /></button>
            <div className="mb-10">
              <h2 className="font-black text-3xl sm:text-4xl tracking-tight mb-2">Agendar</h2>
              <div className="h-2 w-16 bg-indigo-600 rounded-full"></div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-500 ml-1 tracking-widest">Solicitante</label>
                <input required placeholder="Nome completo do participante" className={`w-full px-6 py-4 sm:py-5 rounded-2xl border-2 outline-none focus:ring-4 focus:ring-indigo-500/20 transition-all text-base sm:text-lg font-bold ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-400' : 'bg-slate-50 border-slate-100 focus:border-indigo-400 focus:bg-white'}`} value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-500 ml-1 tracking-widest">E-mail</label>
                <input required type="email" placeholder="email@tjrr.jus.br" className={`w-full px-6 py-4 sm:py-5 rounded-2xl border-2 outline-none focus:ring-4 focus:ring-indigo-500/20 transition-all text-base sm:text-lg font-bold ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-400' : 'bg-slate-50 border-slate-100 focus:border-indigo-400 focus:bg-white'}`} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-500 ml-1 tracking-widest">Assunto</label>
                <textarea required maxLength={150} rows={2} placeholder="O que será tratado?" className={`w-full px-6 py-4 sm:py-5 rounded-2xl border-2 outline-none focus:ring-4 focus:ring-indigo-500/20 transition-all text-base sm:text-lg font-bold resize-none ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-400' : 'bg-slate-50 border-slate-100 focus:border-indigo-400 focus:bg-white'}`} value={formData.assunto} onChange={e => setFormData({...formData, assunto: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-5 sm:gap-8">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-slate-500 ml-1 tracking-widest">Data</label>
                  <input required type="date" className={`w-full px-5 py-4 sm:py-5 border-2 rounded-2xl font-black text-sm sm:text-base outline-none focus:border-indigo-400 ${darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100'}`} value={formData.data} onChange={e => setFormData({...formData, data: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-slate-500 ml-1 tracking-widest">Início</label>
                  <select required className={`w-full px-5 py-4 sm:py-5 border-2 rounded-2xl font-black text-sm sm:text-base outline-none focus:border-indigo-400 appearance-none ${darkMode ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-slate-50 border-slate-100 text-indigo-600 font-black'}`} value={formData.horaInicio} onChange={e => setFormData({...formData, horaInicio: e.target.value})}>
                    {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <button disabled={loading} className="w-full bg-indigo-600 text-white py-5 sm:py-7 rounded-[2rem] font-black shadow-2xl shadow-indigo-500/40 hover:bg-indigo-700 transition-all uppercase text-sm sm:text-base tracking-[0.2em] mt-8 flex items-center justify-center gap-4 active:scale-95 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin w-6 h-6" /> : 'Confirmar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL REMOVER */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl z-[60] flex items-center justify-center p-4">
          <div className={`rounded-[3rem] w-full max-w-lg shadow-2xl p-10 sm:p-14 text-center animate-in zoom-in-95 duration-200 border ${darkMode ? 'bg-slate-900 border-slate-800 shadow-black' : 'bg-white border-white'}`}>
            <div className="bg-red-500/10 p-6 rounded-full mb-8 inline-block ring-8 ring-red-500/5">
              <AlertTriangle className="w-12 h-12 text-red-500" />
            </div>
            <h3 className="text-2xl sm:text-3xl font-black mb-4 tracking-tight leading-tight">Remover Agendamento?</h3>
            <p className="text-sm sm:text-base text-slate-500 mb-10 font-bold italic px-4 leading-relaxed">"{deleteConfirm.eventTitle}"</p>
            <div className="flex gap-4 sm:gap-6">
              <button onClick={() => setDeleteConfirm({ isOpen: false, eventId: null, eventTitle: '' })} className={`flex-1 py-5 rounded-3xl border-2 font-black text-xs sm:text-sm transition-all uppercase tracking-widest ${darkMode ? 'border-slate-800 text-slate-500 hover:bg-slate-800' : 'border-slate-100 text-slate-400 hover:bg-slate-50'}`}>Manter</button>
              <button onClick={() => handleDelete(deleteConfirm.eventId)} disabled={loading} className="flex-1 py-5 rounded-3xl bg-red-600 text-white font-black hover:bg-red-700 transition-all text-xs sm:text-sm active:scale-95 uppercase tracking-widest shadow-xl shadow-red-500/20">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST FLUTUANTE */}
      {toast && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-auto sm:right-10 px-6 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5 z-[100] animate-in slide-in-from-bottom sm:slide-in-from-right duration-500 border-l-[10px] w-[95%] sm:w-auto backdrop-blur-2xl ${toast.type === 'error' ? 'bg-red-600 text-white border-red-800 shadow-red-900/30' : (darkMode ? 'bg-slate-800 text-white border-indigo-500 shadow-black/60' : 'bg-slate-900 text-white border-indigo-600')}`}>
          <div className="flex-1 pr-4">
            <p className="text-[10px] font-black uppercase opacity-60 tracking-widest mb-1">{toast.type === 'error' ? 'Erro Crítico' : 'Operação Concluída'}</p>
            <p className="text-sm sm:text-base font-black leading-tight tracking-tight">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="p-1.5 hover:bg-white/10 rounded-full"><X className="w-5 h-5 opacity-50" /></button>
        </div>
      )}
    </div>
  );
}