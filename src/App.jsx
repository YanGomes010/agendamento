import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Plus, Trash2, Clock, User, Mail, Settings, Loader2,
  AlertCircle, X, CheckCircle2, Search, Terminal, WifiOff, FileText, 
  AlertTriangle, Moon, Sun, Link, Briefcase
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
  const [view, setView] = useState('sheets'); 
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Modais
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

  // Guardar a vaga que foi clicada para agendamento
  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [formData, setFormData] = useState({ nome: '', email: '', assunto: '' });
  
  const [slotData, setSlotData] = useState({ data: new Date().toISOString().split('T')[0], horario: '08:30', atendente: '' });

  const addLog = useCallback((msg, type = 'info') => {
    const messageString = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    setDebugLog(prev => [{ timestamp: new Date().toLocaleTimeString(), msg: messageString, type }, ...prev].slice(0, 10));
  }, []);

  const showToast = useCallback((message, type = 'success') => { 
    setToast({ message: String(message), type }); 
    setTimeout(() => setToast(null), 4000); 
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
            throw new Error(data?.error || "Vaga indisponível ou em conflito."); 
        }
        throw new Error(data?.error || `Erro HTTP ${res.status}`);
      }
      addLog(`Sucesso: ${action}`, 'success');
      return data;
    } catch (err) { 
      const errorStr = String(err.message).toLowerCase();
      if (errorStr.includes('failed to fetch') || errorStr.includes('cors')) {
        addLog("Bloqueio CORS", 'error');
        showToast("Falha de Conexão. Verifique o CORS.", "error");
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

  // Lista dinâmica de atendentes de forma segura
  const safeSlots = Array.isArray(slots) ? slots : [];
  const uniqueAtendentes = [...new Set(safeSlots.map(s => String(s?.atendente || s?.Atendente || '')).filter(a => a.trim() !== '' && a !== 'undefined' && a !== 'null'))];

  // ABRIR MODAL DE AGENDAMENTO
  const handleOpenBookingModal = (slot) => {
    setSelectedSlotForBooking(slot);
    setFormData({ nome: '', email: '', assunto: '' });
    setIsModalOpen(true);
  };

  // ENVIAR AGENDAMENTO
  const handleSubmitBooking = async (e) => {
    e.preventDefault();
    if (!selectedSlotForBooking) return;

    // LEITOR DE DATAS BLINDADO (Não quebra a interface se a data vier mal formatada da planilha)
    let day = new Date().getDate();
    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();
    
    try {
      const rawData = String(selectedSlotForBooking.data || '').trim();
      if (rawData.includes('/')) {
        const p = rawData.split('/');
        if (p.length >= 3) {
          if (p[2].length >= 4) { day = p[0]; month = p[1]; year = p[2]; } 
          else { year = p[0]; month = p[1]; day = p[2]; } 
        }
      } else if (rawData.includes('-')) {
        const p = rawData.split('-');
        if (p.length >= 3) {
          if (p[0].length >= 4) { year = p[0]; month = p[1]; day = p[2]; } 
          else { day = p[0]; month = p[1]; year = p[2]; } 
        }
      } else {
        const d = new Date(rawData);
        if (!isNaN(d.getTime())) {
          year = d.getFullYear(); month = d.getMonth() + 1; day = d.getDate();
        }
      }
    } catch (error) {
      console.error("Erro a ler a data da planilha:", error);
    }

    const timeParts = String(selectedSlotForBooking.horario || '08:00').split(':');
    const hour = parseInt(timeParts[0] || '8', 10);
    const min = parseInt(timeParts[1] || '0', 10);

    const start = new Date(year, month - 1, day, hour, min);
    
    if (isNaN(start.getTime())) {
      return showToast("Erro: A data da vaga na planilha não é válida.", "error");
    }

    const end = new Date(start.getTime() + 120 * 60000); // +2 horas

    // 1. Criar no Calendário
    const calResult = await callN8N('create', { 
      inicio: toRFC3339WithLocalOffset(start),
      fim: toRFC3339WithLocalOffset(end),
      nome: formData.nome, 
      email: formData.email, 
      assunto: formData.assunto
    });

    if (!calResult) return;

    // 2. Atualizar Status na Planilha
    const sheetResult = await callN8N('update_slot', {
      id: selectedSlotForBooking.id,
      status: 'Ocupado',
      nome_cliente: formData.nome,
      contato_cliente: formData.email
    });

    if (sheetResult) {
      showToast(`Agendamento confirmado com sucesso!`); 
      setIsModalOpen(false); 
      setSelectedSlotForBooking(null);
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
      showToast("Item removido da lista."); 
      setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' }); 
      await fetchData(); 
    }
  };

  // Filtros
  const safeEvents = Array.isArray(events) ? events : [];
  const filteredEvents = safeEvents.filter(e => {
    if (!e || typeof e !== 'object') return false;
    const search = String(searchTerm || '').toLowerCase();
    const summary = String(e.summary || '').toLowerCase();
    
    let eventDate = '';
    if (e.start?.dateTime) eventDate = String(e.start.dateTime).split('T')[0];
    else if (e.start?.date) eventDate = String(e.start.date);

    return summary.includes(search) && (!dateFilter || eventDate === dateFilter);
  });

  const filteredSlots = safeSlots.filter(s => {
    if (!s || typeof s !== 'object' || s.status === 'Excluído') return false;
    
    const search = String(searchTerm || '').toLowerCase();
    const matchesSearch = String(s.horario || '').includes(search) || 
                          String(s.nome_cliente || '').toLowerCase().includes(search) || 
                          String(s.atendente || s.Atendente || '').toLowerCase().includes(search);
    
    const parts = String(s.data || '').split('/');
    const slotIso = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
    
    return matchesSearch && (!dateFilter || slotIso === dateFilter);
  });

  const getSafeDateRender = (startObj) => {
    try {
      const s = startObj?.dateTime || startObj?.date;
      if (!s) return "Sem data";
      const d = new Date(s);
      if (isNaN(d.getTime())) return "Data inválida";
      return d.toLocaleDateString('pt-PT', { day:'2-digit', month:'2-digit' }) + ' às ' + d.toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'});
    } catch {
      return "Erro";
    }
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-200 ${darkMode ? 'bg-slate-950 text-slate-200' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* HEADER MOBILE-FIRST APP STYLE */}
      <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b ${darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/90 border-slate-200'}`}>
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-md">
              <Calendar size={24} />
            </div>
            <h1 className="font-bold text-xl tracking-tight">Ouvidoria</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => setIsConfigOpen(!isConfigOpen)} className={`p-2 rounded-full transition-colors ${darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}>
              <Settings size={22} className={loading ? 'animate-spin text-indigo-500' : ''} />
            </button>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-full transition-colors ${darkMode ? 'hover:bg-slate-800 text-yellow-400' : 'hover:bg-slate-100 text-indigo-500'}`}>
              {darkMode ? <Sun size={22} /> : <Moon size={22} />}
            </button>
          </div>
        </div>

        {/* TABS (Segmented Control) */}
        <div className="max-w-3xl mx-auto px-4 pb-3 flex gap-4">
          <button 
            onClick={() => setView('sheets')} 
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${view === 'sheets' ? 'bg-slate-800 text-white shadow-md dark:bg-indigo-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'}`}
          >
            Vagas da Planilha
          </button>
          <button 
            onClick={() => setView('calendar')} 
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${view === 'calendar' ? 'bg-slate-800 text-white shadow-md dark:bg-indigo-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'}`}
          >
            Eventos Agendados
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6 pb-32">
        
        {/* ACTIONS & FILTERS BAR */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              placeholder={`Buscar ${view === 'sheets' ? 'vagas' : 'eventos'}...`} 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm outline-none transition-all ${darkMode ? 'bg-slate-900 border-slate-700 focus:border-indigo-500' : 'bg-white border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50'}`} 
            />
          </div>
          <div className="flex gap-2">
            <input 
              type="date" 
              value={dateFilter} 
              onChange={e => setDateFilter(e.target.value)} 
              className={`flex-1 sm:flex-none px-4 py-3 rounded-xl border text-sm outline-none min-w-[140px] ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`} 
            />
            {view === 'sheets' && (
              <button 
                onClick={() => setIsSlotModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-xl font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Plus size={18} /> Novo
              </button>
            )}
          </div>
        </div>

        {/* LISTAGEM DE VAGAS (SHEETS) */}
        {view === 'sheets' && (
          <div className="space-y-4">
            {filteredSlots.length === 0 && !loading && (
               <div className="text-center py-12 text-slate-400">
                 <FileText size={48} className="mx-auto mb-3 opacity-20" />
                 <p>Nenhuma vaga encontrada.</p>
               </div>
            )}
            
            {filteredSlots.map((slot, index) => {
              const isLivre = slot?.status === 'Livre';
              return (
                <div key={slot?.id || index} className={`rounded-2xl p-5 border relative transition-all ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm hover:shadow-md'}`}>
                  
                  {/* Cabeçalho do Card */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <Clock size={20} className={isLivre ? 'text-indigo-500' : 'text-orange-500'} />
                      <span className="font-bold text-xl">{String(slot?.horario || '--:--')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase tracking-wider ${isLivre ? (darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700') : (darkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-700')}`}>
                        {String(slot?.status || 'N/D')}
                      </span>
                      <button onClick={() => setDeleteConfirm({ isOpen: true, id: slot?.id, title: `${slot?.data} às ${slot?.horario}`, type: 'slot' })} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Corpo do Card */}
                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Calendar size={16} /> <span>{String(slot?.data || '--/--/----')}</span>
                    </div>
                    <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                      <Briefcase size={16} className="text-indigo-400/70" /> <span>{String(slot?.atendente || slot?.Atendente || 'Balcão')}</span>
                    </div>
                    
                    {!isLivre && slot?.nome_cliente && (
                      <div className="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
                        <User size={16} className="text-orange-400" />
                        <span className="font-medium text-slate-600 dark:text-slate-300 truncate">{String(slot.nome_cliente)}</span>
                      </div>
                    )}
                  </div>

                  {/* Botão de Ação Direto no Cartão */}
                  {isLivre && (
                    <button 
                      onClick={() => handleOpenBookingModal(slot)}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl py-3 font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={18} /> Agendar Atendimento
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* LISTAGEM DE EVENTOS (CALENDAR) */}
        {view === 'calendar' && (
          <div className="space-y-4">
            {filteredEvents.length === 0 && !loading && (
               <div className="text-center py-12 text-slate-400">
                 <Calendar size={48} className="mx-auto mb-3 opacity-20" />
                 <p>Nenhum evento agendado.</p>
               </div>
            )}

            {filteredEvents.map((event, index) => (
              <div key={event?.id || index} className={`rounded-2xl p-5 border relative transition-all ${darkMode ? 'bg-slate-900 border-slate-800 border-l-4 border-l-indigo-500' : 'bg-white border-slate-200 border-l-4 border-l-indigo-500 shadow-sm'}`}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg leading-tight pr-8">{String(event?.summary || '(Sem Título)')}</h3>
                  <button onClick={() => setDeleteConfirm({ isOpen: true, id: event?.id, title: event?.summary, type: 'event' })} className="text-slate-400 hover:text-red-500 transition-colors absolute top-4 right-4 p-1">
                    <Trash2 size={18} />
                  </button>
                </div>
                
                <div className="space-y-2 text-sm mt-4">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
                    <Clock size={16} className="text-indigo-400" /> 
                    {getSafeDateRender(event?.start)}
                  </div>
                  {event?.attendees?.[0]?.email && (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Mail size={16} /> <span className="truncate">{String(event.attendees[0].email)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* MODAL: CRIAR VAGA */}
      {isSlotModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md p-6 sm:rounded-3xl rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-bold text-xl">Abrir Nova Vaga</h2>
              <button onClick={() => setIsSlotModalOpen(false)} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 rounded-full"><X size={20} /></button>
            </div>
            
            <form onSubmit={handleCreateSlot} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">Data</label>
                  <input required type="date" className={`w-full px-4 py-3 rounded-xl border outline-none text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200 focus:border-indigo-400 focus:bg-white'}`} value={slotData.data} onChange={e => setSlotData({...slotData, data: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">Horário</label>
                  <input required placeholder="08:30" className={`w-full px-4 py-3 rounded-xl border outline-none text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200 focus:border-indigo-400 focus:bg-white'}`} value={slotData.horario} onChange={e => setSlotData({...slotData, horario: e.target.value})} />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">Atendente / Balcão</label>
                <input required list="atendentes-list" placeholder="Escreva ou escolha..." className={`w-full px-4 py-3 rounded-xl border outline-none text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200 focus:border-indigo-400 focus:bg-white'}`} value={slotData.atendente} onChange={e => setSlotData({...slotData, atendente: e.target.value})} />
                <datalist id="atendentes-list">
                  {uniqueAtendentes.map((nome, i) => <option key={`atendente-${i}`} value={nome} />)}
                </datalist>
              </div>

              <button disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 rounded-xl font-bold mt-2 shadow-md transition-colors flex justify-center items-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={20} /> : 'Salvar Vaga'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REALIZAR AGENDAMENTO */}
      {isModalOpen && selectedSlotForBooking && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md p-6 sm:rounded-3xl rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="font-bold text-xl mb-1">Confirmar Agendamento</h2>
                <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1.5">
                  <Calendar size={16} /> {selectedSlotForBooking.data} às {selectedSlotForBooking.horario}
                </p>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                  <Briefcase size={14} /> Atendente: {selectedSlotForBooking.atendente || 'Balcão'}
                </p>
              </div>
              <button onClick={() => {setIsModalOpen(false); setSelectedSlotForBooking(null)}} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 rounded-full"><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmitBooking} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">Nome Completo</label>
                <input required placeholder="Nome do solicitante" className={`w-full px-4 py-3 rounded-xl border outline-none text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200 focus:border-emerald-500 focus:bg-white'}`} value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">E-mail</label>
                <input required type="email" placeholder="email@tjrr.jus.br" className={`w-full px-4 py-3 rounded-xl border outline-none text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200 focus:border-emerald-500 focus:bg-white'}`} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              
              <button disabled={loading} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-xl font-bold mt-2 shadow-md transition-colors flex justify-center items-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={20} /> : 'Confirmar e Enviar Convite'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMAÇÃO EXCLUIR */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm p-6 rounded-3xl shadow-2xl text-center animate-in zoom-in-95 duration-200 ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className="bg-red-100 text-red-500 p-4 rounded-full inline-block mb-4 dark:bg-red-500/20"><Trash2 size={32} /></div>
            <h3 className="font-bold text-xl mb-2">Excluir Registo?</h3>
            <p className="text-sm text-slate-500 mb-6 px-4 line-clamp-2">{deleteConfirm.title}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Cancelar</button>
              <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm shadow-md">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATIONS */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-lg z-[100] animate-in slide-in-from-top-4 flex items-center gap-2 text-sm font-semibold whitespace-nowrap border ${toast.type === 'error' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {toast.message}
        </div>
      )}

      {/* PAINEL DE CONFIGURAÇÃO (MODAL) */}
      {isConfigOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className={`w-full max-w-lg p-6 rounded-3xl shadow-2xl animate-in zoom-in-95 ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
             <div className="flex justify-between items-center mb-6">
              <h2 className="font-bold text-xl flex items-center gap-2"><Settings size={20}/> Configurações</h2>
              <button onClick={() => setIsConfigOpen(false)} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 rounded-full"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase ml-1">URL do Webhook (n8n)</label>
                <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} className={`w-full px-4 py-3 rounded-xl border outline-none text-sm font-mono ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200'}`} />
              </div>
              <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-emerald-400 h-40 overflow-y-auto mt-4">
                {debugLog.map((log, i) => (
                  <div key={i} className="mb-2"><span className="text-slate-500">[{log.timestamp}]</span> <span className={log.type === 'error' ? 'text-red-400' : ''}>{log.msg}</span></div>
                ))}
                {debugLog.length === 0 && <span className="text-slate-600">Nenhum registo de atividade...</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}