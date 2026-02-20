import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Plus, Trash2, Clock, User, Mail, Settings, Loader2,
  AlertCircle, X, CheckCircle2, RefreshCw, Search, Terminal,
  WifiOff, Filter, FileText, AlertTriangle, Moon, Sun, Link,
  Briefcase
} from 'lucide-react';

// --- HELPERS SEGUROS ---
function toRFC3339WithLocalOffset(date) {
  try {
    if (!date || isNaN(date.getTime())) return new Date().toISOString();
    const pad = (n) => String(n).padStart(2, '0');
    const tzOffsetMin = date.getTimezoneOffset();
    const sign = tzOffsetMin > 0 ? '-' : '+';
    const abs = Math.abs(tzOffsetMin);
    const offH = pad(Math.floor(abs / 60));
    const offM = pad(abs % 60);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offH}:${offM}`;
  } catch (e) {
    return new Date().toISOString();
  }
}

export default function App() {
  const [webhookUrl, setWebhookUrl] = useState("https://n8n-ouvidoria.tjrr.jus.br/webhook/calendar-api");
  const [view, setView] = useState('calendar'); 
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState(''); 
  const [debugLog, setDebugLog] = useState([]);
  const [viewRange, setViewRange] = useState(30);
  const [conflictDetails, setConflictDetails] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, id: null, title: '', type: 'event' });

  const [formData, setFormData] = useState({ nome: '', email: '', assunto: '', data: '', horaInicio: '' });
  const [slotData, setSlotData] = useState({ data: new Date().toISOString().split('T')[0], horario: '08:30', atendente: '' });

  const addLog = useCallback((msg, type = 'info') => {
    const messageString = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    setDebugLog(prev => [{ timestamp: new Date().toLocaleTimeString(), msg: messageString, type }, ...prev].slice(0, 10));
  }, []);

  const showToast = useCallback((message, type = 'success') => { 
    setToast({ message: String(message), type }); 
    setTimeout(() => setToast(null), 6000); 
  }, []);

  const callN8N = useCallback(async (action, payload = {}) => {
    setLoading(true);
    setConflictDetails(null);
    addLog(`Ação iniciada: ${action}`);
    try {
      const res = await fetch(webhookUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        mode: 'cors', 
        body: JSON.stringify({ action, ...payload }) 
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) { 
            throw new Error(data?.error || "A vaga já foi ocupada ou está indisponível."); 
        }
        throw new Error(data?.error || `Erro do Servidor (HTTP ${res.status})`);
      }
      addLog(`Sucesso: ${action}`, 'success');
      return data;
    } catch (err) { 
      const errorStr = String(err.message).toLowerCase();
      if (errorStr.includes('failed to fetch') || errorStr.includes('falha no fetch') || errorStr.includes('network error') || errorStr.includes('cors')) {
        addLog("Bloqueio de CORS ou Endpoint inativo", 'error');
        showToast("Falha de Conexão! Verifique as configurações de CORS.", "error");
      } else {
        addLog(err.message, 'error'); 
        showToast(err.message, "error"); 
      }
      return null; 
    } finally { setLoading(false); }
  }, [addLog, showToast, webhookUrl]);

  const fetchData = useCallback(async () => {
    try {
      const resSlots = await callN8N('list_slots');
      if (resSlots && Array.isArray(resSlots.data)) setSlots(resSlots.data);
      else if (resSlots && resSlots.data && typeof resSlots.data === 'object') setSlots([resSlots.data]);
      else setSlots([]);

      if (view === 'calendar') {
        const now = new Date();
        const listStart = toRFC3339WithLocalOffset(new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)));
        const listEnd = toRFC3339WithLocalOffset(new Date(now.getTime() + (viewRange * 24 * 60 * 60 * 1000)));
        const resEvents = await callN8N('list', { listStart, listEnd });
        
        if (resEvents && Array.isArray(resEvents.data)) setEvents(resEvents.data);
        else if (resEvents && resEvents.data && Array.isArray(resEvents.data.items)) setEvents(resEvents.data.items);
        else if (resEvents && resEvents.data && typeof resEvents.data === 'object') setEvents([resEvents.data]); 
        else setEvents([]);
      }
    } catch (error) {
      console.error("Erro no fetchData:", error);
    }
  }, [view, viewRange, callN8N]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- FILTROS DE VAGAS E LISTA DINÂMICA DE ATENDENTES ---
  const safeSlots = Array.isArray(slots) ? slots : [];
  const availableSlots = safeSlots.filter(s => s.status === 'Livre');
  const availableDates = [...new Set(availableSlots.map(s => s.data))];
  const timesForDate = availableSlots.filter(s => s.data === formData.data);
  
  const uniqueAtendentes = [...new Set(safeSlots.map(s => String(s.atendente || s.Atendente || '')).filter(a => a.trim() !== '' && a !== 'undefined' && a !== 'null'))];

  const handleSubmit = async (e) => {
    e.preventDefault();
    const slotSelecionado = availableSlots.find(s => s.data === formData.data && s.horario === formData.horaInicio);
    
    if (!slotSelecionado) {
      return showToast("Selecione uma data e horário válidos.", "error");
    }

    // --- LEITOR UNIVERSAL DE DATAS (Resolve o bug do dia atual) ---
    let day, month, year;
    const rawData = String(slotSelecionado.data).trim();
    
    if (rawData.includes('/')) {
      const p = rawData.split('/');
      if (p[2].length === 4) { day = p[0]; month = p[1]; year = p[2]; } // Formato PT/BR: DD/MM/YYYY
      else { year = p[0]; month = p[1]; day = p[2]; } // Formato Inverso: YYYY/MM/DD
    } else if (rawData.includes('-')) {
      const p = rawData.split('-');
      if (p[0].length === 4) { year = p[0]; month = p[1]; day = p[2]; } // Formato ISO: YYYY-MM-DD
      else { day = p[0]; month = p[1]; year = p[2]; } // Formato Raro: DD-MM-YYYY
    } else {
      const d = new Date(rawData);
      year = d.getFullYear(); month = d.getMonth() + 1; day = d.getDate();
    }

    const timeParts = String(slotSelecionado.horario || '08:00').split(':');
    const hour = parseInt(timeParts[0] || '8', 10);
    const min = parseInt(timeParts[1] || '0', 10);

    const start = new Date(year, month - 1, day, hour, min);
    
    // Verificação de segurança:
    if (isNaN(start.getTime())) {
      return showToast("Formato de data inválido na planilha. Verifique como a vaga foi criada.", "error");
    }

    const end = new Date(start.getTime() + 120 * 60000); // Adiciona 2 horas

    // --- JOGADA DUPLA: Calendário + Planilha ---
    
    // 1. Criar no Google Calendar primeiro
    const calResult = await callN8N('create', { 
      inicio: toRFC3339WithLocalOffset(start),
      fim: toRFC3339WithLocalOffset(end),
      nome: formData.nome, 
      email: formData.email, 
      assunto: formData.assunto
    });

    if (!calResult) return; // Se falhar, pára aqui.

    // 2. Atualizar o Status na Planilha para "Ocupado"
    const sheetResult = await callN8N('update_slot', {
      id: slotSelecionado.id,
      status: 'Ocupado',
      nome_cliente: formData.nome,
      contato_cliente: formData.email
    });

    if (sheetResult) {
      showToast(`Agendamento confirmado para ${day}/${month}/${year} às ${slotSelecionado.horario}!`); 
      setIsModalOpen(false); 
      setFormData({ nome: '', email: '', assunto: '', data: '', horaInicio: '' });
      await fetchData(); 
    }
  };

  const handleCreateSlot = async (e) => {
    e.preventDefault();
    if (!slotData.data) return;
    const parts = slotData.data.split('-');
    if (parts.length !== 3) return;
    const formattedData = `${parts[2]}/${parts[1]}/${parts[0]}`;
    
    const result = await callN8N('create_slot', { 
      data: formattedData, 
      horario: slotData.horario,
      atendente: slotData.atendente 
    });
    
    if (result) { 
      showToast("Vaga aberta com sucesso!"); 
      setIsSlotModalOpen(false); 
      setSlotData({ data: new Date().toISOString().split('T')[0], horario: '08:30', atendente: '' });
      await fetchData(); 
    }
  };

  const handleDelete = async (id, type) => {
    if (!id) return;
    const action = type === 'slot' ? 'delete_slot' : 'delete';
    const payload = type === 'slot' ? { id } : { eventId: id };
    const result = await callN8N(action, payload);
    if (result) { 
      showToast("Removido com sucesso."); 
      setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' }); 
      await fetchData(); 
    }
  };

  const filteredEvents = (Array.isArray(events) ? events : []).filter(e => {
    if (!e || typeof e !== 'object') return false;
    const search = String(searchTerm || '').toLowerCase();
    const summary = String(e.summary || '').toLowerCase();
    const email = String(e.attendees?.[0]?.email || '').toLowerCase();
    
    const matchesSearch = summary.includes(search) || email.includes(search);
    
    let eventDate = '';
    if (e.start?.dateTime) eventDate = String(e.start.dateTime).split('T')[0];
    else if (e.start?.date) eventDate = String(e.start.date);

    return matchesSearch && (!dateFilter || eventDate === dateFilter);
  });

  const filteredSlots = safeSlots.filter(s => {
    if (!s || typeof s !== 'object') return false;
    if (s.status === 'Excluído') return false;
    
    const search = String(searchTerm || '').toLowerCase();
    const horario = String(s.horario || '').toLowerCase();
    const nomeCliente = String(s.nome_cliente || '').toLowerCase();
    const dataStr = String(s.data || '');
    const atendenteStr = String(s.atendente || s.Atendente || '').toLowerCase();
    
    const matchesSearch = horario.includes(search) || nomeCliente.includes(search) || dataStr.includes(search) || atendenteStr.includes(search);
    
    const parts = dataStr.split('/');
    const slotIso = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
    
    return matchesSearch && (!dateFilter || slotIso === dateFilter);
  });

  const getSafeDateRender = (startObj) => {
    try {
      const s = startObj?.dateTime || startObj?.date;
      if (!s) return "Sem data definida";
      const d = new Date(s);
      if (isNaN(d.getTime())) return "Data inválida";
      return d.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch {
      return "Erro na data";
    }
  };

  return (
    <div className={`min-h-screen transition-all duration-300 font-sans p-2 sm:p-8 ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* HEADER */}
      <header className="max-w-6xl mx-auto mb-10 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className={`p-8 sm:p-12 rounded-[3.5rem] shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-10 border transition-all ${darkMode ? 'bg-slate-900 border-slate-800 shadow-black/40' : 'bg-white border-white'}`}>
          <div className="flex items-center gap-8 w-full lg:w-auto">
            <div className="bg-indigo-600 p-6 rounded-[2rem] shadow-xl text-white flex-shrink-0">
              <Calendar size={56} />
            </div>
            <div>
              <h1 className="font-black text-4xl sm:text-6xl tracking-tighter leading-none mb-3">Ouvidoria</h1>
              <div className="flex gap-6 mt-4">
                <button onClick={() => setView('calendar')} className={`text-xl font-black uppercase tracking-widest pb-2 border-b-4 transition-all ${view === 'calendar' ? 'border-indigo-500 text-indigo-500' : 'border-transparent opacity-30'}`}>Calendário</button>
                <button onClick={() => setView('sheets')} className={`text-xl font-black uppercase tracking-widest pb-2 border-b-4 transition-all ${view === 'sheets' ? 'border-emerald-500 text-emerald-500' : 'border-transparent opacity-30'}`}>Planilha Vagas</button>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center lg:justify-end gap-6 w-full lg:w-auto">
            <button onClick={() => setIsConfigOpen(!isConfigOpen)} className={`p-6 rounded-3xl border transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-slate-100 border-slate-200 text-indigo-600'}`}>
              <Settings size={32} className={loading ? 'animate-spin' : ''} />
            </button>
            <button 
              onClick={() => view === 'calendar' ? setIsModalOpen(true) : setIsSlotModalOpen(true)} 
              className={`${view === 'calendar' ? 'bg-indigo-600' : 'bg-emerald-600'} text-white px-12 py-6 rounded-[2.5rem] font-black text-2xl shadow-2xl active:scale-95 transition-all flex items-center gap-5 uppercase tracking-tighter`}
            >
              <Plus size={36} /> {view === 'calendar' ? 'Novo Agendamento' : 'Abrir Horário'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-12 pb-32">
        {/* CONFIGURAÇÕES E RESOLUÇÃO DE PROBLEMAS */}
        {isConfigOpen && (
          <div className={`border rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 duration-300 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex justify-between items-center mb-8 pb-6 border-b transition-all border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-5 text-3xl font-black"><Terminal size={40} className="text-indigo-500" /> Sistema & Monitor</div>
              <button onClick={() => setDarkMode(!darkMode)} className={`flex items-center gap-4 px-10 py-5 rounded-3xl text-lg font-black uppercase tracking-widest transition-all ${darkMode ? 'bg-slate-800 text-yellow-400' : 'bg-slate-100 text-indigo-600'}`}>
                {darkMode ? <Sun size={28} /> : <Moon size={28} />} {darkMode ? 'Luz' : 'Noite'}
              </button>
            </div>
            
            <div className="mb-10 p-8 rounded-[2.5rem] border-2 border-amber-500/30 bg-amber-500/5">
                <label className="text-xl font-black uppercase text-amber-600 flex items-center gap-3 mb-4"><Link size={24} /> Endereço do Webhook (n8n)</label>
                <input 
                  value={webhookUrl} 
                  onChange={e => setWebhookUrl(e.target.value)} 
                  className={`w-full px-8 py-5 rounded-[2rem] border-2 outline-none font-mono text-xl mb-6 ${darkMode ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`} 
                />
            </div>

            <div className="bg-slate-950 rounded-[2rem] p-8 font-mono text-lg text-indigo-400/90 h-56 overflow-y-auto border border-slate-800 leading-relaxed shadow-inner">
              {debugLog.length === 0 && <span className="opacity-50">A aguardar atividade...</span>}
              {debugLog.map((log, i) => (
                <div key={i} className="mb-3 pb-3 border-b border-slate-900/50">
                  <span className="text-slate-600 font-bold">[{log.timestamp}]</span> <span className={log.type === 'error' ? 'text-red-400 font-bold' : 'text-emerald-400'}>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FILTROS GIGANTES */}
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="relative flex-1 group">
            <Search className={`absolute left-8 top-1/2 -translate-y-1/2 w-8 h-8 ${darkMode ? 'text-slate-600' : 'text-slate-300'}`} />
            <input placeholder={`Pesquisar em ${view === 'calendar' ? 'eventos' : 'vagas'}...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className={`w-full pl-20 pr-10 py-7 border rounded-[3rem] outline-none focus:ring-8 transition-all text-2xl font-black ${darkMode ? 'bg-slate-900 border-slate-800 text-white focus:ring-indigo-900/20' : 'bg-white border-slate-200 focus:ring-indigo-50 shadow-2xl'}`} />
          </div>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className={`px-10 py-7 border rounded-[3rem] outline-none focus:ring-8 transition-all text-2xl font-black ${darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 shadow-2xl'}`} />
        </div>

        {/* LISTAGEM CALENDÁRIO */}
        {view === 'calendar' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 animate-in fade-in duration-500">
            {filteredEvents.map((event, index) => (
              <div key={event?.id || `evt-${index}`} className={`border rounded-[3.5rem] p-10 hover:shadow-2xl transition-all border-l-[24px] border-l-indigo-600 flex flex-col justify-between min-h-[380px] relative overflow-hidden group ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-lg'}`}>
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <span className={`text-xl font-black px-7 py-2 rounded-full uppercase tracking-widest border ${darkMode ? 'bg-indigo-900/30 text-indigo-400 border-indigo-900/50' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>Agendado</span>
                    <button onClick={() => setDeleteConfirm({ isOpen: true, id: event?.id, title: event?.summary || 'Evento', type: 'event' })} className="p-4 text-slate-400 hover:text-red-500 transition-all active:scale-90"><Trash2 size={40} /></button>
                  </div>
                  <h3 className="font-black text-4xl sm:text-5xl mb-10 line-clamp-2 leading-tight tracking-tight text-slate-800 dark:text-slate-100">{String(event?.summary || '(Sem Título)')}</h3>
                </div>
                <div className={`space-y-6 pt-10 border-t transition-all ${darkMode ? 'border-slate-800' : 'border-slate-50'}`}>
                  <div className="flex items-center gap-6 text-2xl font-black text-slate-600 dark:text-slate-400"><Clock size={32} className="text-indigo-500 flex-shrink-0" /> {getSafeDateRender(event?.start)}</div>
                  <div className="flex items-center gap-6 text-xl italic truncate font-bold text-slate-400"><Mail size={32} className="text-indigo-500/20 flex-shrink-0" /> {String(event?.attendees?.[0]?.email || 'Sem contacto')}</div>
                </div>
              </div>
            ))}
            {!loading && filteredEvents.length === 0 && (
               <div className="col-span-full py-20 text-center text-slate-400 text-2xl font-bold">Nenhum evento encontrado no Calendário.</div>
            )}
          </div>
        )}

        {/* LISTAGEM SHEETS */}
        {view === 'sheets' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 animate-in fade-in duration-500">
            {filteredSlots.map((slot, index) => (
              <div key={slot?.id || `slt-${index}`} className={`border rounded-[3.5rem] p-10 hover:shadow-2xl transition-all border-l-[24px] ${slot?.status === 'Livre' ? 'border-l-emerald-500' : 'border-l-amber-500'} flex flex-col justify-between min-h-[380px] relative overflow-hidden ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-lg'}`}>
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <span className={`text-xl font-black px-7 py-2 rounded-full uppercase tracking-widest border ${slot?.status === 'Livre' ? (darkMode ? 'bg-emerald-900/30 text-emerald-400 border-emerald-900/50' : 'bg-emerald-50 text-emerald-700 border-emerald-200') : (darkMode ? 'bg-amber-900/30 text-amber-400 border-amber-900/50' : 'bg-amber-50 text-amber-700 border-amber-200')}`}>{String(slot?.status || 'N/D')}</span>
                    <button onClick={() => setDeleteConfirm({ isOpen: true, id: slot?.id, title: `${slot?.data} - ${slot?.horario}`, type: 'slot' })} className="p-4 text-slate-400 hover:text-red-500 transition-all active:scale-90"><Trash2 size={40} /></button>
                  </div>
                  <h3 className="font-black text-5xl sm:text-6xl mb-3 text-slate-800 dark:text-slate-100">{String(slot?.horario || '--:--')}</h3>
                  <p className="font-black text-3xl text-slate-400 uppercase tracking-widest">{String(slot?.data || '--/--/----')}</p>
                </div>
                
                {slot?.status === 'Ocupado' && (
                  <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex items-center gap-5 text-2xl font-black text-slate-600 dark:text-slate-400"><User size={32} className="text-amber-500 flex-shrink-0" /> {String(slot?.nome_cliente || 'Privado')}</div>
                  </div>
                )}
                
                {/* RODAPÉ DO CARD COM ATENDENTE E ID */}
                <div className="mt-auto pt-8 flex justify-between items-end border-t border-slate-100 dark:border-slate-800 mt-6">
                   <div className="flex items-center gap-3 text-xl font-bold text-slate-400 dark:text-slate-500">
                     <Briefcase size={28} className="text-indigo-400/50" />
                     <span className="truncate max-w-[150px]">{String(slot?.atendente || slot?.Atendente || 'Sem Atendente')}</span>
                   </div>
                   <p className="text-sm font-bold text-slate-300 uppercase tracking-widest">ID: {String(slot?.id || 'Sem ID')}</p>
                </div>
              </div>
            ))}
            {!loading && filteredSlots.length === 0 && (
               <div className="col-span-full py-20 text-center text-slate-400 text-2xl font-bold">Nenhuma vaga encontrada na Planilha.</div>
            )}
          </div>
        )}
      </main>

      {/* MODAL NOVO EVENTO (SÓ COM VAGAS LIVRES) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-[4rem] w-full max-w-4xl shadow-2xl p-12 sm:p-24 animate-in zoom-in-95 duration-300 relative my-auto border transition-all ${darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-white'}`}>
            <button onClick={() => setIsModalOpen(false)} className="absolute top-12 right-12 p-5 hover:bg-slate-800/10 rounded-full text-slate-400"><X size={56} /></button>
            <h2 className="font-black text-6xl sm:text-8xl tracking-tight mb-16">Novo Agendamento</h2>
            
            {availableDates.length === 0 ? (
              <div className="text-center py-10">
                <AlertTriangle size={80} className="mx-auto text-amber-500 mb-6" />
                <p className="text-3xl font-bold text-slate-400">Não há vagas livres na planilha neste momento.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-12">
                <div className="space-y-4"><label className="text-2xl font-black uppercase text-slate-500 ml-4">Nome do Solicitante</label><input required placeholder="Nome completo" className={`w-full px-12 py-8 rounded-[3rem] border-2 outline-none focus:ring-8 text-3xl font-bold ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-400' : 'bg-slate-50 border-slate-100 focus:border-indigo-400 focus:bg-white'}`} value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} /></div>
                <div className="space-y-4"><label className="text-2xl font-black uppercase text-slate-500 ml-4">E-mail de Contacto</label><input required type="email" placeholder="email@tjrr.jus.br" className={`w-full px-12 py-8 rounded-[3rem] border-2 outline-none focus:ring-8 text-3xl font-bold ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-400' : 'bg-slate-50 border-slate-100 focus:border-indigo-400 focus:bg-white'}`} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
                
                <div className="grid grid-cols-2 gap-12">
                  <div className="space-y-4">
                    <label className="text-2xl font-black uppercase text-slate-500 ml-4">Data Disponível</label>
                    <select required className={`w-full px-10 py-8 rounded-[3rem] border-2 text-3xl font-black appearance-none ${darkMode ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-slate-50 border-slate-100 text-indigo-600'}`} value={formData.data} onChange={e => setFormData({...formData, data: e.target.value, horaInicio: ''})}>
                      <option value="">Selecione...</option>
                      {availableDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="space-y-4">
                    <label className="text-2xl font-black uppercase text-slate-500 ml-4">Horário Livre</label>
                    <select required disabled={!formData.data} className={`w-full px-10 py-8 rounded-[3rem] border-2 text-3xl font-black appearance-none disabled:opacity-50 ${darkMode ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-slate-50 border-slate-100 text-indigo-600'}`} value={formData.horaInicio} onChange={e => setFormData({...formData, horaInicio: e.target.value})}>
                      <option value="">Selecione...</option>
                      {timesForDate.map(s => <option key={s.id} value={s.horario}>{s.horario} - {s.atendente || 'Balcão'}</option>)}
                    </select>
                  </div>
                </div>
                <button disabled={loading} className="w-full bg-indigo-600 text-white py-10 rounded-[4rem] font-black shadow-2xl text-4xl uppercase active:scale-95 transition-all mt-8">{loading ? 'A processar...' : 'Confirmar Audiência'}</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL ABRIR VAGA (SHEETS) */}
      {isSlotModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-[4rem] w-full max-w-4xl shadow-2xl p-12 sm:p-24 animate-in zoom-in-95 duration-300 relative my-auto border transition-all ${darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-white'}`}>
            <button onClick={() => setIsSlotModalOpen(false)} className="absolute top-12 right-12 p-5 hover:bg-slate-800/10 rounded-full text-slate-400"><X size={56} /></button>
            <h2 className="font-black text-6xl sm:text-8xl tracking-tight mb-16">Abrir Vaga</h2>
            <form onSubmit={handleCreateSlot} className="space-y-12">
              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-4"><label className="text-2xl font-black uppercase text-slate-500 ml-4">Data</label><input required type="date" className={`w-full px-12 py-8 rounded-[3rem] border-2 text-3xl font-black ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-400' : 'bg-slate-50 border-slate-100 focus:border-emerald-400 focus:bg-white'}`} value={slotData.data} onChange={e => setSlotData({...slotData, data: e.target.value})} /></div>
                <div className="space-y-4"><label className="text-2xl font-black uppercase text-slate-500 ml-4">Horário</label><input required placeholder="Ex: 08:30" className={`w-full px-12 py-8 rounded-[3rem] border-2 text-3xl font-black ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-400' : 'bg-slate-50 border-slate-100 focus:border-emerald-400 focus:bg-white'}`} value={slotData.horario} onChange={e => setSlotData({...slotData, horario: e.target.value})} /></div>
              </div>
              
              {/* NOVO CAMPO: Atendente com Auto-complete */}
              <div className="space-y-4">
                <label className="text-2xl font-black uppercase text-slate-500 ml-4">Atendente / Balcão</label>
                <input 
                  required 
                  list="atendentes-list"
                  placeholder="Selecione na lista ou escreva um novo..." 
                  className={`w-full px-12 py-8 rounded-[3rem] border-2 text-3xl font-black ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-400' : 'bg-slate-50 border-slate-100 focus:border-emerald-400 focus:bg-white'}`} 
                  value={slotData.atendente} 
                  onChange={e => setSlotData({...slotData, atendente: e.target.value})} 
                />
                <datalist id="atendentes-list">
                  {uniqueAtendentes.map(nome => (
                    <option key={nome} value={nome} />
                  ))}
                </datalist>
              </div>

              <button disabled={loading} className="w-full bg-emerald-600 text-white py-10 rounded-[4rem] font-black shadow-2xl text-4xl uppercase active:scale-95 transition-all mt-8">Abrir Horário Livre</button>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMAÇÃO EXCLUIR */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl z-[60] flex items-center justify-center p-4">
          <div className={`rounded-[4rem] w-full max-w-2xl shadow-2xl p-16 text-center animate-in zoom-in-95 duration-200 border ${darkMode ? 'bg-slate-900 border-slate-800 shadow-black' : 'bg-white border-white'}`}>
            <div className="bg-red-500/10 p-10 rounded-full mb-10 inline-block ring-8 ring-red-500/5 text-red-500"><Trash2 size={80} /></div>
            <h3 className="text-5xl sm:text-6xl font-black mb-12 tracking-tight">Remover item?</h3>
            <div className="flex gap-8">
              <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`flex-1 py-8 rounded-[3rem] border-2 font-black text-2xl transition-all uppercase ${darkMode ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}>Manter</button>
              <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className="flex-1 py-8 rounded-[3rem] bg-red-600 text-white font-black text-2xl active:scale-95 uppercase shadow-xl shadow-red-500/20">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST FLUTUANTE */}
      {toast && (
        <div className={`fixed bottom-12 left-1/2 -translate-x-1/2 sm:translate-x-0 sm:left-auto sm:right-12 px-14 py-10 rounded-[4rem] shadow-2xl flex items-center gap-10 z-[100] animate-in slide-in-from-bottom sm:slide-in-from-right duration-500 border-l-[24px] w-[95%] sm:w-auto backdrop-blur-2xl ${toast.type === 'error' ? 'bg-red-600 text-white border-red-800' : (darkMode ? 'bg-slate-800 text-white border-indigo-500 shadow-black/60' : 'bg-slate-900 text-white border-indigo-600')}`}>
          <div className="flex-1">
            <p className="text-2xl sm:text-3xl font-black leading-tight tracking-tight">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="p-4 hover:bg-white/10 rounded-full"><X size={48} /></button>
        </div>
      )}
    </div>
  );
}