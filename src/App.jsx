import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Plus, Trash2, Clock, User, Mail, Settings, Loader2,
  AlertCircle, X, Search, Terminal, FileText, AlertTriangle, Moon, Sun, Check, Briefcase, RefreshCw, Info, Phone, Eye
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

// FORMATADOR DE TELEFONE
const formatPhone = (value) => {
  let v = value.replace(/\D/g, ''); 
  if (v.length <= 10) {
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
    v = v.replace(/(\d{4})(\d)/, '$1-$2');
  } else {
    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
  }
  return v.slice(0, 15);
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export default function App() {
  const [webhookUrl, setWebhookUrl] = useState("https://n8n-ouvidoria.tjrr.jus.br/webhook/calendar-api");
  const [view, setView] = useState('sheets'); 
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [eventDetailsModal, setEventDetailsModal] = useState(null); 
  
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState(''); 
  const [debugLog, setDebugLog] = useState([]);
  const [viewRange, setViewRange] = useState(30);
  const [conflictDetails, setConflictDetails] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, id: null, title: '', type: 'event' });

  const [rescheduleData, setRescheduleData] = useState({ active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: '' });

  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [formData, setFormData] = useState({ nome: '', email: '', telefone: '', assunto: '' });
  const [slotData, setSlotData] = useState({ data: new Date().toISOString().split('T')[0], horario: '08:30', atendente: '' });

  const safeEvents = Array.isArray(events) ? events : [];
  const safeSlots = Array.isArray(slots) ? slots : [];

  const uniqueAtendentes = [...new Set(safeSlots.map(s => String(s?.atendente || s?.Atendente || '')).filter(a => a.trim() !== '' && a !== 'undefined' && a !== 'null'))];

  const addLog = useCallback((msg, type = 'info') => {
    const messageString = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    setDebugLog(prev => [{ timestamp: new Date().toLocaleTimeString(), msg: messageString, type }, ...prev].slice(0, 10));
  }, []);

  const showToast = useCallback((message, type = 'success') => { 
    setToast({ message: String(message), type }); 
    setTimeout(() => setToast(null), 5000); 
  }, []);

  const callN8N = useCallback(async (action, payload = {}) => {
    setLoading(true);
    setConflictDetails(null);
    addLog(`Ação: ${action}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); 

    try {
      const res = await fetch(webhookUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        mode: 'cors', 
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) { 
            throw new Error(data?.error || "Vaga indisponível ou em conflito."); 
        }
        throw new Error(data?.error || `Erro do Servidor (HTTP ${res.status}).`);
      }
      addLog(`Sucesso: ${action}`, 'success');
      return data;
    } catch (err) { 
      clearTimeout(timeoutId);
      const errorStr = String(err.message).toLowerCase();
      
      if (err.name === 'AbortError' || errorStr.includes('abort')) {
        addLog("Timeout (15s)", 'error');
        showToast("O servidor demorou a responder.", "error");
      } else if (errorStr.includes('failed to fetch') || errorStr.includes('cors')) {
        addLog("Bloqueio de Ligação", 'error');
        showToast("Falha de Conexão com o n8n.", "error");
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

  const handleOpenBookingModal = (slot) => {
    setSelectedSlotForBooking(slot);
    if (rescheduleData.active) {
      setFormData({ nome: rescheduleData.oldName, email: rescheduleData.oldEmail, telefone: rescheduleData.oldPhone, assunto: 'Remarcação' });
    } else if (!formData.nome) { 
      setFormData({ nome: '', email: '', telefone: '', assunto: '' }); 
    }
    setIsModalOpen(true);
  };

  const handleSubmitBooking = async (e) => {
    e.preventDefault();
    if (!selectedSlotForBooking) return;

    if (!isValidEmail(formData.email)) return showToast("E-mail inválido.", "error");
    if (formData.telefone.replace(/\D/g, '').length < 10) return showToast("Telefone incompleto.", "error");

    let day = new Date().getDate(), month = new Date().getMonth() + 1, year = new Date().getFullYear();
    try {
      const rawData = String(selectedSlotForBooking.data || '').trim();
      if (rawData.includes('/')) {
        const p = rawData.split('/');
        if (p.length >= 3) {
          if (p[2].length >= 4) { day = p[0]; month = p[1]; year = p[2]; } else { year = p[0]; month = p[1]; day = p[2]; } 
        }
      } else if (rawData.includes('-')) {
        const p = rawData.split('-');
        if (p.length >= 3) {
          if (p[0].length >= 4) { year = p[0]; month = p[1]; day = p[2]; } else { day = p[0]; month = p[1]; year = p[2]; } 
        }
      }
    } catch (error) {}

    const timeParts = String(selectedSlotForBooking.horario || '08:00').split(':');
    const start = new Date(year, month - 1, day, parseInt(timeParts[0] || '8', 10), parseInt(timeParts[1] || '0', 10));
    const end = new Date(start.getTime() + 120 * 60000);

    const previousSlots = [...safeSlots];

    setSlots(prev => prev.map(s => s.id === selectedSlotForBooking.id ? { ...s, status: 'Ocupado', nome_cliente: formData.nome, contato_cliente: `${formData.email} | ${formData.telefone}` } : s));
    setIsModalOpen(false); 
    showToast(`A agendar ${formData.nome}...`); 

    const calResult = await callN8N('create', { 
      inicio: toRFC3339WithLocalOffset(start),
      fim: toRFC3339WithLocalOffset(end),
      nome: formData.nome, 
      email: formData.email, 
      telefone: formData.telefone, 
      assunto: formData.assunto
    });

    if (calResult) {
      const sheetResult = await callN8N('update_slot', {
        id: selectedSlotForBooking.id, 
        status: 'Ocupado', 
        nome_cliente: formData.nome, 
        contato_cliente: `${formData.email} | ${formData.telefone}`
      });

      if (sheetResult) {
        if (rescheduleData.active && rescheduleData.eventId) {
           setEvents(prev => prev.filter(ev => ev.id !== rescheduleData.eventId));
           const oldSlot = safeSlots.find(s => s.contato_cliente && s.contato_cliente.includes(rescheduleData.oldEmail) && s.status === 'Ocupado' && s.id !== selectedSlotForBooking.id);
           if (oldSlot) {
               setSlots(prev => prev.map(s => s.id === oldSlot.id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '' } : s));
           }

           await callN8N('delete', { eventId: rescheduleData.eventId });
           if (oldSlot) await callN8N('update_slot', { id: oldSlot.id, status: 'Livre', nome_cliente: '', contato_cliente: '' });

           setRescheduleData({ active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: '' });
           showToast(`Remarcação confirmada!`, "success");
        } else {
           showToast(`Agendamento confirmado!`, "success"); 
        }

        setSelectedSlotForBooking(null);
        setFormData({ nome: '', email: '', telefone: '', assunto: '' });
      } else { setSlots(previousSlots); }
    } else { setSlots(previousSlots); }

    setTimeout(() => fetchData(), 2000);
  };

  const handleCreateSlot = async (e) => {
    e.preventDefault();
    if (!slotData.data) return;
    const parts = slotData.data.split('-');
    if (parts.length !== 3) return;
    const formattedData = `${parts[2]}/${parts[1]}/${parts[0]}`;
    
    const previousSlots = [...safeSlots];
    const tempId = Date.now();
    setSlots(prev => [...(prev || []), { id: tempId, data: formattedData, horario: slotData.horario, status: 'Livre', atendente: slotData.atendente }]);
    setIsSlotModalOpen(false); 

    const result = await callN8N('create_slot', { data: formattedData, horario: slotData.horario, atendente: slotData.atendente });
    
    if (result) { 
      showToast("Vaga aberta com sucesso!"); 
      setSlotData({ data: new Date().toISOString().split('T')[0], horario: '08:30', atendente: '' });
    } else { setSlots(previousSlots); }
    setTimeout(() => fetchData(), 1000);
  };

  const handleDelete = async (id, type) => {
    if (!id) return;
    setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' }); 

    const prevEvents = [...safeEvents];
    const prevSlots = [...safeSlots];

    if (type === 'event') {
      const eventToDelete = safeEvents.find(e => e.id === id);
      const eventEmail = eventToDelete?.attendees?.[0]?.email;

      setEvents(prev => prev.filter(e => e.id !== id));
      showToast("Cancelando no calendário...");
      
      const res = await callN8N('delete', { eventId: id });
      if (!res) { setEvents(prevEvents); return; }

      if (eventEmail) {
        const matchingSlot = safeSlots.find(s => s.contato_cliente && s.contato_cliente.includes(eventEmail) && s.status === 'Ocupado');
        if (matchingSlot) {
          setSlots(prev => prev.map(s => s.id === matchingSlot.id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '' } : s));
          await callN8N('update_slot', { id: matchingSlot.id, status: 'Livre', nome_cliente: '', contato_cliente: '' });
        }
      }
      showToast("Cancelado com sucesso!");

    } else if (type === 'slot') {
      const slotToDelete = safeSlots.find(s => s.id === id);

      if (slotToDelete?.status === 'Ocupado') {
        setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '' } : s));
        showToast("Libertando vaga...");

        const res = await callN8N('update_slot', { id: id, status: 'Livre', nome_cliente: '', contato_cliente: '' });
        if (!res) { setSlots(prevSlots); return; }

        const matchingEvent = safeEvents.find(e => e.attendees?.[0]?.email && slotToDelete.contato_cliente && slotToDelete.contato_cliente.includes(e.attendees[0].email));
        if (matchingEvent) {
          setEvents(prev => prev.filter(e => e.id !== matchingEvent.id));
          await callN8N('delete', { eventId: matchingEvent.id });
        }
        showToast("Vaga libertada!");
      } else {
        setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'Excluído' } : s));
        showToast("A excluir vaga...");
        const res = await callN8N('delete_slot', { id });
        if (!res) { setSlots(prevSlots); return; } 
        showToast("Vaga removida da grelha.");
      }
    }
  };

  const handleReschedule = () => {
    const eventToReschedule = safeEvents.find(e => e.id === deleteConfirm.id);
    if (!eventToReschedule) return;

    const desc = String(eventToReschedule.description || '');
    const nameMatch = desc.match(/Solicitante:\s*(.+)/);
    const telMatch = desc.match(/Telefone:\s*(.+)/);
    
    let extractedName = nameMatch ? nameMatch[1].trim() : String(eventToReschedule.summary || '');
    if (extractedName.includes(': ')) extractedName = extractedName.split(': ')[1];
    
    const extractedEmail = eventToReschedule.attendees?.[0]?.email || '';
    const extractedTel = telMatch ? telMatch[1].trim() : '';

    setRescheduleData({ active: true, eventId: eventToReschedule.id, oldName: extractedName, oldEmail: extractedEmail, oldPhone: extractedTel });
    setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' });
    setView('sheets');
    showToast("Modo Remarcação. Escolha a nova vaga.", "info");
  };

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

  const filteredEvents = safeEvents.filter(e => {
    if (!e || typeof e !== 'object' || e.status === 'cancelled') return false;
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
                          String(s.atendente || s.Atendente || '').toLowerCase().includes(search) ||
                          String(s.contato_cliente || '').toLowerCase().includes(search);
    const parts = String(s.data || '').split('/');
    const slotIso = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
    return matchesSearch && (!dateFilter || slotIso === dateFilter);
  });

  const extractEventDetails = (event) => {
    if (!event) return {};
    const desc = String(event.description || '');
    const nameMatch = desc.match(/Solicitante:\s*(.+)/);
    const telMatch = desc.match(/Telefone:\s*(.+)/);
    
    return {
      nome: nameMatch ? nameMatch[1].trim() : '',
      telefone: telMatch ? telMatch[1].trim() : 'Não informado',
      email: event.attendees?.[0]?.email || 'Não informado',
      assunto: String(event.summary || '(Sem Título)'),
      data: getSafeDateRender(event.start)
    };
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-200 ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* HEADER DE TOPO ESTILO APP NATIVA */}
      <header className={`sticky top-0 z-40 w-full backdrop-blur-xl border-b transition-colors duration-300 ${darkMode ? 'bg-slate-950/80 border-slate-800 shadow-xl shadow-black/20' : 'bg-white/90 border-slate-200 shadow-sm'}`}>
        <div className="max-w-4xl mx-auto px-5 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-3 rounded-2xl text-white shadow-lg shadow-indigo-500/30">
              <Calendar size={26} strokeWidth={2.5} />
            </div>
            <h1 className="font-black text-2xl tracking-tight">Ouvidoria</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => {fetchData(); showToast("A atualizar...");}} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}>
              <RefreshCw size={22} className={loading ? 'animate-spin text-indigo-500' : ''} />
            </button>
            <button onClick={() => setIsConfigOpen(!isConfigOpen)} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}>
              <Settings size={22} />
            </button>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'text-amber-400 hover:bg-slate-800' : 'text-indigo-600 hover:bg-slate-100'}`}>
              {darkMode ? <Sun size={22} /> : <Moon size={22} />}
            </button>
          </div>
        </div>

        {/* CONTROLO DE ABAS CENTRALIZADO E ELEGANTE */}
        <div className="max-w-md mx-auto px-4 pb-4 flex gap-2">
          <button onClick={() => setView('sheets')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${view === 'sheets' ? (darkMode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-white shadow-lg shadow-slate-800/20') : (darkMode ? 'bg-slate-900 text-slate-400 hover:bg-slate-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}>
            Vagas
          </button>
          <button onClick={() => setView('calendar')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${view === 'calendar' ? (darkMode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-white shadow-lg shadow-slate-800/20') : (darkMode ? 'bg-slate-900 text-slate-400 hover:bg-slate-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}>
            Agendados
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6 pb-32">
        
        {/* BANNER MODO REMARCAÇÃO COM DESTAQUE */}
        {rescheduleData.active && (
          <div className={`p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg animate-in slide-in-from-top-4 ${darkMode ? 'bg-indigo-900/40 border border-indigo-500/30' : 'bg-indigo-50 border border-indigo-200'}`}>
             <div className="flex items-center gap-4">
                <div className={`p-2 rounded-full ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-200 text-indigo-700'}`}>
                  <Info size={24} />
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Modo Remarcação</p>
                  <p className={`font-semibold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                    Escolha a nova vaga para <strong className="font-black">{rescheduleData.oldName || rescheduleData.oldEmail}</strong>
                  </p>
                </div>
             </div>
             <button 
                onClick={() => setRescheduleData({active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: ''})} 
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-colors w-full sm:w-auto shadow-sm ${darkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
             >
               Cancelar
             </button>
          </div>
        )}

        {/* BARRA DE PESQUISA E FILTROS */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
            <input placeholder={`Procurar em ${view === 'sheets' ? 'vagas' : 'eventos'}...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} 
                   className={`w-full pl-12 pr-4 py-4 rounded-2xl border text-sm font-medium outline-none transition-all ${darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500' : 'bg-white border-slate-200 text-slate-800 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50'}`} />
          </div>
          <div className="flex gap-2">
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} 
                   className={`flex-1 sm:flex-none px-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all min-w-[150px] ${darkMode ? 'bg-slate-900 border-slate-800 text-white focus:border-indigo-500' : 'bg-white border-slate-200 text-slate-800 focus:border-indigo-400'}`} />
            {view === 'sheets' && (
              <button onClick={() => setIsSlotModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-4 rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 whitespace-nowrap active:scale-95">
                <Plus size={20} strokeWidth={3} /> Novo
              </button>
            )}
          </div>
        </div>

        {/* --- LISTAGEM DE VAGAS (SHEETS) --- */}
        {view === 'sheets' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredSlots.length === 0 && !loading && (
               <div className="col-span-full text-center py-16">
                 <FileText size={56} className={`mx-auto mb-4 ${darkMode ? 'text-slate-800' : 'text-slate-200'}`} />
                 <p className={`font-medium ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Nenhuma vaga encontrada na lista.</p>
               </div>
            )}
            
            {filteredSlots.map((slot, index) => {
              const isLivre = slot?.status === 'Livre';
              const contactInfo = String(slot.contato_cliente || '');
              const [emailSlot, phoneSlot] = contactInfo.includes('|') ? contactInfo.split('|').map(s => s.trim()) : [contactInfo, ''];

              return (
                <div key={slot?.id ? String(slot.id) : `slot-${index}`} className={`rounded-3xl p-6 border relative transition-all duration-300 group ${darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-100'}`}>
                  
                  {/* CABEÇALHO DO CARTÃO DA VAGA */}
                  <div className="flex justify-between items-start mb-5">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${isLivre ? (darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600') : (darkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600')}`}>
                        <Clock size={22} strokeWidth={2.5} />
                      </div>
                      <span className={`font-black text-3xl tracking-tight ${darkMode ? 'text-white' : 'text-slate-800'}`}>{String(slot?.horario || '--:--')}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase tracking-widest ${isLivre ? (darkMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border border-emerald-200') : (darkMode ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-orange-100 text-orange-700 border border-orange-200')}`}>
                        {String(slot?.status || 'N/D')}
                      </span>
                      <button onClick={() => setDeleteConfirm({ isOpen: true, id: slot?.id, title: `${slot?.data} às ${slot?.horario}`, type: 'slot' })} className={`p-2 rounded-lg transition-colors ${darkMode ? 'text-slate-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  
                  {/* INFORMAÇÕES DA VAGA */}
                  <div className="space-y-3 mb-6">
                    <div className={`flex items-center gap-3 text-sm font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      <Calendar size={18} className="opacity-70" /> <span>{String(slot?.data || '--/--/----')}</span>
                    </div>
                    <div className={`flex items-center gap-3 text-sm font-bold ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      <Briefcase size={18} className={darkMode ? 'text-indigo-400' : 'text-indigo-500'} /> <span>{String(slot?.atendente || slot?.Atendente || 'Balcão')}</span>
                    </div>
                    
                    {!isLivre && slot?.nome_cliente && (
                      <div className={`pt-4 mt-4 border-t space-y-3 ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                        <div className={`flex items-center gap-3 font-black text-base ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                          <User size={18} className={darkMode ? 'text-orange-400' : 'text-orange-500'} />
                          <span className="truncate">{String(slot.nome_cliente)}</span>
                        </div>
                        {phoneSlot && phoneSlot !== 'Não informado' && phoneSlot !== 'undefined' && (
                          <div className={`flex items-center gap-3 text-sm font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            <Phone size={16} className="opacity-70" />
                            <span>{phoneSlot}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* BOTÃO DE AÇÃO */}
                  {isLivre && (
                    <button onClick={() => handleOpenBookingModal(slot)} className={`w-full py-4 rounded-xl font-black text-sm shadow-lg transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${rescheduleData.active ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 animate-pulse' : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/30'}`}>
                      {rescheduleData.active ? 'Confirmar Remarcação Aqui' : 'Agendar Atendimento'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* --- LISTAGEM DE EVENTOS (CALENDAR) --- */}
        {view === 'calendar' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredEvents.length === 0 && !loading && (
               <div className="col-span-full text-center py-16">
                 <Calendar size={56} className={`mx-auto mb-4 ${darkMode ? 'text-slate-800' : 'text-slate-200'}`} />
                 <p className={`font-medium ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Nenhum evento agendado.</p>
               </div>
            )}

            {filteredEvents.map((event, index) => {
              const details = extractEventDetails(event);
              const isRemarcacao = details.assunto.toLowerCase().includes('remarcação');

              return (
                <div key={event?.id ? String(event.id) : `event-${index}`} className={`rounded-3xl p-6 border relative transition-all duration-300 ${darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-100'}`}>
                  
                  {/* LINHA DE COR LATERAL */}
                  <div className={`absolute left-0 top-6 bottom-6 w-1.5 rounded-r-md ${isRemarcacao ? 'bg-amber-500' : 'bg-indigo-500'}`}></div>

                  <div className="flex justify-between items-start mb-4 pl-4">
                    {/* ASSUNTO COM TRUNCATE PARA NÃO QUEBRAR O LAYOUT */}
                    <h3 className={`font-black text-xl leading-tight pr-16 break-words line-clamp-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                      {details.assunto}
                    </h3>
                    
                    <div className="absolute top-5 right-5 flex gap-1">
                      <button onClick={() => setEventDetailsModal(event)} className={`p-2.5 rounded-xl transition-colors ${darkMode ? 'text-indigo-400 hover:text-white hover:bg-slate-800' : 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50'}`} title="Ver Detalhes">
                        <Eye size={20} />
                      </button>
                      <button onClick={() => setDeleteConfirm({ isOpen: true, id: event?.id, title: details.assunto, type: 'event' })} className={`p-2.5 rounded-xl transition-colors ${darkMode ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`} title="Remover / Remarcar">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mt-5 pl-4">
                    {details.nome && details.nome !== details.assunto && (
                      <div className={`flex items-center gap-3 font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                        <User size={18} className={darkMode ? 'text-indigo-400' : 'text-indigo-500'} /> <span className="truncate">{details.nome}</span>
                      </div>
                    )}
                    <div className={`flex items-center gap-3 font-semibold text-sm ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                      <Clock size={18} className={darkMode ? 'text-indigo-400' : 'text-indigo-500'} /> 
                      {details.data}
                    </div>
                    {details.telefone && details.telefone !== 'Não informado' && (
                      <div className={`flex items-center gap-3 font-medium text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Phone size={18} className="opacity-70" /> <span className="truncate">{details.telefone}</span>
                      </div>
                    )}
                    {details.email && details.email !== 'Não informado' && (
                      <div className={`flex items-center gap-3 font-medium text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Mail size={18} className="opacity-70" /> <span className="truncate">{details.email}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* MODAL DE DETALHES COMPLETOS COM CORREÇÃO DE COR */}
      {eventDetailsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className={`flex justify-between items-start mb-6 pb-6 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <h2 className={`font-black text-2xl flex items-center gap-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                <FileText size={28} className="text-indigo-500"/> Ficha Resumo
              </h2>
              <button onClick={() => setEventDetailsModal(null)} className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Assunto / Motivo</p>
                <p className={`text-xl font-black leading-relaxed whitespace-pre-wrap break-words ${darkMode ? 'text-slate-100' : 'text-slate-800'}`}>{extractEventDetails(eventDetailsModal).assunto}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-6 pt-4">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Clock size={14}/> Horário</p>
                  <p className={`font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).data}</p>
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><User size={14}/> Solicitante</p>
                  <p className={`font-bold text-sm truncate ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).nome || 'Não consta'}</p>
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Phone size={14}/> Telefone</p>
                  <p className={`font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).telefone}</p>
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Mail size={14}/> E-mail</p>
                  <p className={`font-bold text-sm truncate ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).email}</p>
                </div>
              </div>
            </div>
            
            <button onClick={() => setEventDetailsModal(null)} className={`w-full mt-10 py-4 rounded-2xl font-black text-sm transition-colors active:scale-95 ${darkMode ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>Fechar Ficha</button>
          </div>
        </div>
      )}

      {/* MODAL: CRIAR VAGA */}
      {isSlotModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md p-8 sm:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto overscroll-contain ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className="flex justify-between items-center mb-8">
              <h2 className={`font-black text-3xl ${darkMode ? 'text-white' : 'text-slate-800'}`}>Nova Vaga</h2>
              <button onClick={() => setIsSlotModalOpen(false)} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleCreateSlot} className="space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Data</label>
                  <input required type="date" className={`w-full px-5 py-4 rounded-2xl border text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} value={slotData.data} onChange={e => setSlotData({...slotData, data: e.target.value})} />
                </div>
                <div>
                  <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Horário</label>
                  <input required placeholder="08:30" className={`w-full px-5 py-4 rounded-2xl border text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} value={slotData.horario} onChange={e => setSlotData({...slotData, horario: e.target.value})} />
                </div>
              </div>
              
              <div>
                <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Atendente / Balcão</label>
                <input required list="atendentes-list" placeholder="Escreva ou escolha..." className={`w-full px-5 py-4 rounded-2xl border text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} value={slotData.atendente} onChange={e => setSlotData({...slotData, atendente: e.target.value})} />
                <datalist id="atendentes-list">
                  {uniqueAtendentes.map((nome, i) => <option key={`atendente-${i}`} value={nome} />)}
                </datalist>
              </div>

              <button disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black text-lg mt-6 shadow-lg shadow-indigo-600/30 transition-all flex justify-center items-center gap-2 active:scale-95">
                {loading ? <Loader2 className="animate-spin" size={24} /> : 'Salvar Vaga'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REALIZAR AGENDAMENTO COM CORES CORRIGIDAS */}
      {isModalOpen && selectedSlotForBooking && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md p-8 sm:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto overscroll-contain ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className={`font-black text-2xl mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{rescheduleData.active ? 'Nova Data' : 'Agendar'}</h2>
                <p className={`text-sm font-bold flex items-center gap-2 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  <Calendar size={16} /> {String(selectedSlotForBooking.data || '')} às {String(selectedSlotForBooking.horario || '')}
                </p>
                <p className={`text-xs mt-2 flex items-center gap-2 font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <Briefcase size={14} /> Atendente: {String(selectedSlotForBooking.atendente || 'Balcão')}
                </p>
              </div>
              <button onClick={() => {setIsModalOpen(false); setSelectedSlotForBooking(null)}} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmitBooking} className="space-y-5">
              <div>
                <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Nome Completo</label>
                <input required placeholder="Ex: Yan Gomes" className={`w-full px-5 py-4 rounded-2xl border text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Telefone</label>
                  <input required placeholder="(95) 90000-0000" className={`w-full px-5 py-4 rounded-2xl border text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} 
                         value={formData.telefone} 
                         onChange={e => setFormData({...formData, telefone: formatPhone(e.target.value)})} />
                </div>
                <div>
                  <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>E-mail</label>
                  <input required type="email" placeholder="@tjrr.jus.br" className={`w-full px-5 py-4 rounded-2xl border text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>
              
              <div>
                <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Assunto / Motivo</label>
                <textarea required rows="2" placeholder="Descreva brevemente..." className={`w-full px-5 py-4 rounded-2xl border text-base font-semibold outline-none transition-all resize-none ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.assunto} onChange={e => setFormData({...formData, assunto: e.target.value})} />
              </div>
              
              <button disabled={loading} className={`w-full text-white py-4 rounded-2xl font-black text-lg mt-6 shadow-lg transition-all flex justify-center items-center gap-2 active:scale-95 ${rescheduleData.active ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30' : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/30'}`}>
                {loading ? <Loader2 className="animate-spin" size={24} /> : (rescheduleData.active ? 'Finalizar Remarcação' : 'Confirmar e Enviar')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMAÇÃO EXCLUIR / REMARCAR */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm p-8 rounded-[2rem] shadow-2xl text-center animate-in zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            
            {deleteConfirm.type === 'event' ? (
              <>
                <div className={`p-5 rounded-full inline-block mb-6 ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}><RefreshCw size={36} /></div>
                <h3 className={`font-black text-2xl mb-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>Gerir Agendamento</h3>
                <p className={`text-sm font-medium mb-8 px-2 break-words line-clamp-3 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>O que deseja fazer com <strong className={darkMode ? 'text-slate-300' : 'text-slate-700'}>"{String(deleteConfirm.title)}"</strong>?</p>
                <div className="flex flex-col gap-3">
                  <button onClick={handleReschedule} disabled={loading} className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95">
                    Remarcar Data
                  </button>
                  <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className={`w-full py-4 rounded-xl font-bold text-sm transition-all ${darkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                    Cancelar Definitivamente
                  </button>
                  <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`w-full py-3 rounded-xl font-bold text-sm transition-all mt-2 ${darkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-300' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                    Voltar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={`p-5 rounded-full inline-block mb-6 ${darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'}`}><Trash2 size={36} /></div>
                <h3 className={`font-black text-2xl mb-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>Excluir Vaga?</h3>
                <p className={`text-sm font-medium mb-8 px-2 break-words line-clamp-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{String(deleteConfirm.title)}</p>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`flex-1 py-4 rounded-xl font-bold text-sm transition-all ${darkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Manter</button>
                  <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className="flex-1 py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-sm shadow-lg shadow-red-600/30 transition-all active:scale-95">Excluir</button>
                </div>
              </>
            )}
            
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl shadow-2xl z-[100] animate-in slide-in-from-top-4 flex items-center gap-3 text-sm font-bold whitespace-nowrap border ${toast.type === 'error' ? (darkMode ? 'bg-red-950/90 text-red-400 border-red-900 shadow-red-900/50' : 'bg-red-50 text-red-600 border-red-200') : (toast.type === 'info' ? (darkMode ? 'bg-indigo-950/90 text-indigo-400 border-indigo-900' : 'bg-indigo-50 text-indigo-600 border-indigo-200') : (darkMode ? 'bg-emerald-950/90 text-emerald-400 border-emerald-900 shadow-emerald-900/50' : 'bg-emerald-50 text-emerald-600 border-emerald-200'))}`}>
          {toast.type === 'error' ? <AlertCircle size={20} /> : (toast.type === 'info' ? <Info size={20} /> : <Check size={20} />)}
          {toast.message}
        </div>
      )}

      {isConfigOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[70] flex items-center justify-center p-4">
          <div className={`w-full max-w-xl p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 border max-h-[90vh] overflow-y-auto ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
             <div className="flex justify-between items-center mb-8">
              <h2 className={`font-black text-2xl flex items-center gap-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}><Settings size={26} className="text-indigo-500"/> Definições</h2>
              <button onClick={() => setIsConfigOpen(false)} className={`p-2.5 rounded-full transition-colors ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            <div className="space-y-6">
              <div>
                <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>URL do Webhook (n8n)</label>
                <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} className={`w-full px-5 py-4 rounded-2xl border text-sm font-mono outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-300 focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-400'}`} />
              </div>
              <div>
                <label className={`block text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Console de Diagnóstico</label>
                <div className="bg-slate-950 rounded-2xl p-5 font-mono text-xs text-emerald-400 h-48 overflow-y-auto border border-slate-800 shadow-inner">
                  {debugLog.map((log, i) => (
                    <div key={i} className="mb-2.5 pb-2.5 border-b border-slate-900 last:border-0 last:pb-0 last:mb-0">
                      <span className="text-slate-500">[{log.timestamp}]</span> <span className={log.type === 'error' ? 'text-red-400 font-bold' : ''}>{log.msg}</span>
                    </div>
                  ))}
                  {debugLog.length === 0 && <span className="text-slate-600 italic">Nenhum registo de atividade...</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}