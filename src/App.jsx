import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, Plus, Trash2, Clock, User, Mail, Loader2,
  AlertCircle, X, Search, FileText, Moon, Sun, 
  Check, Briefcase, RefreshCw, Info, Phone, Eye, ChevronLeft, ChevronRight, CalendarDays, Repeat, Pencil
} from 'lucide-react';

// --- CONFIGURAÇÃO FIXA ---
const WEBHOOK_URL = "https://n8n-ouvidoria.tjrr.jus.br/webhook/calendar-api";

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

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const PREDEFINED_TIMES = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', 
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', 
  '16:00', '16:30', '17:00', '17:30'
];

const WEEKDAYS = [
  { id: 1, label: 'Seg' }, { id: 2, label: 'Ter' }, { id: 3, label: 'Qua' },
  { id: 4, label: 'Qui' }, { id: 5, label: 'Sex' }, { id: 6, label: 'Sáb' }, { id: 0, label: 'Dom' }
];

export default function App() {
  const [view, setView] = useState('sheets'); 
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [eventDetailsModal, setEventDetailsModal] = useState(null); 
  const [editAtendenteModal, setEditAtendenteModal] = useState({ isOpen: false, slotId: null, currentName: '' });
  
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [activeDate, setActiveDate] = useState(todayStr); 

  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, id: null, title: '', type: 'event' });
  const [rescheduleData, setRescheduleData] = useState({ active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: '' });

  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [formData, setFormData] = useState({ nome: '', email: '', telefone: '', assunto: '' });
  
  const [slotData, setSlotData] = useState({ 
    startDate: todayStr, 
    endDate: '', 
    weekdays: [1, 2, 3, 4, 5],
    times: [], 
    atendentes: [] 
  });
  const [newAtendente, setNewAtendente] = useState('');

  const [progressData, setProgressData] = useState({ active: false, current: 0, total: 0, message: '' });

  const safeEvents = Array.isArray(events) ? events : [];
  const safeSlots = Array.isArray(slots) ? slots : [];

  const uniqueAtendentes = [...new Set(safeSlots.map(s => String(s?.atendente || s?.Atendente || '')).filter(a => a.trim() !== '' && a !== 'undefined' && a !== 'null'))];

  const showToast = useCallback((message, type = 'success') => { 
    setToast({ message: String(message), type }); 
    setTimeout(() => setToast(null), 5000); 
  }, []);

  const callN8N = useCallback(async (action, payload = {}) => {
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); 

    try {
      const res = await fetch(WEBHOOK_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        mode: 'cors', 
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) { throw new Error(data?.error || "Vaga indisponível ou em conflito."); }
        throw new Error(data?.error || `Erro do Servidor (HTTP ${res.status}).`);
      }
      return data;
    } catch (err) { 
      clearTimeout(timeoutId);
      const errorStr = String(err.message).toLowerCase();
      if (err.name === 'AbortError' || errorStr.includes('abort')) {
        showToast("O servidor demorou a responder.", "error");
      } else if (errorStr.includes('failed to fetch') || errorStr.includes('cors')) {
        showToast("Falha de Conexão com o n8n.", "error");
      } else {
        showToast(err.message, "error"); 
      }
      return null; 
    } finally { setLoading(false); }
  }, [showToast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const resSlots = await callN8N('list_slots');
      if (resSlots && Array.isArray(resSlots.data)) setSlots(resSlots.data);
      else if (resSlots && resSlots.data && typeof resSlots.data === 'object') setSlots([resSlots.data]);
      else setSlots([]);

      const now = new Date();
      const listStart = toRFC3339WithLocalOffset(new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)));
      const listEnd = toRFC3339WithLocalOffset(new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000)));
      const resEvents = await callN8N('list', { listStart, listEnd });
      
      if (resEvents && Array.isArray(resEvents.data)) setEvents(resEvents.data);
      else if (resEvents && resEvents.data && Array.isArray(resEvents.data.items)) setEvents(resEvents.data.items);
      else if (resEvents && resEvents.data && typeof resEvents.data === 'object') setEvents([resEvents.data]); 
      else setEvents([]);
    } catch (error) {
      console.error("Erro no fetchData:", error);
    } finally {
      setLoading(false);
    }
  }, [callN8N]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const shiftDate = (days) => {
    const d = new Date(activeDate + 'T12:00:00'); 
    d.setDate(d.getDate() + days);
    setActiveDate(d.toISOString().split('T')[0]);
  };

  const getDisplayDateLabel = () => {
    if (activeDate === todayStr) return "Hoje";
    const amanhã = new Date(todayStr + 'T12:00:00'); 
    amanhã.setDate(amanhã.getDate() + 1);
    if (activeDate === amanhã.toISOString().split('T')[0]) return "Amanhã";
    const ontem = new Date(todayStr + 'T12:00:00'); 
    ontem.setDate(ontem.getDate() - 1);
    if (activeDate === ontem.toISOString().split('T')[0]) return "Ontem";
    
    const d = new Date(activeDate + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  };

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

    setLoading(true);
    let day = new Date().getDate(), month = new Date().getMonth() + 1, year = new Date().getFullYear();
    try {
      const rawData = String(selectedSlotForBooking.data || '').trim();
      if (rawData.includes('/')) {
        const p = rawData.split('/');
        if (p[2].length >= 4) { day = p[0]; month = p[1]; year = p[2]; } else { year = p[0]; month = p[1]; day = p[2]; } 
      } else if (rawData.includes('-')) {
        const p = rawData.split('-');
        if (p[0].length >= 4) { year = p[0]; month = p[1]; day = p[2]; } else { day = p[0]; month = p[1]; year = p[2]; } 
      }
    } catch (error) {}

    const timeParts = String(selectedSlotForBooking.horario || '08:00').split(':');
    const start = new Date(year, month - 1, day, parseInt(timeParts[0] || '8', 10), parseInt(timeParts[1] || '0', 10));
    const end = new Date(start.getTime() + 120 * 60000);

    const previousSlots = [...safeSlots];
    setSlots(prev => prev.map(s => s.id === selectedSlotForBooking.id ? { ...s, status: 'Ocupado', nome_cliente: formData.nome, contato_cliente: `${formData.email} | ${formData.telefone}`, assunto: formData.assunto } : s));
    setIsModalOpen(false); 
    
    setProgressData({ active: true, current: 0, total: 1, message: `A agendar ${formData.nome}...` });

    const calResult = await callN8N('create', { 
      inicio: toRFC3339WithLocalOffset(start), fim: toRFC3339WithLocalOffset(end),
      nome: formData.nome, email: formData.email, telefone: formData.telefone, assunto: formData.assunto
    });

    if (calResult) {
      // Enviando TODOS os campos para o n8n não sobrescrever com valores vazios
      const sheetResult = await callN8N('update_slot', {
        id: selectedSlotForBooking.id, 
        data: selectedSlotForBooking.data || '',
        horario: selectedSlotForBooking.horario || '',
        atendente: selectedSlotForBooking.atendente || selectedSlotForBooking.Atendente || '',
        status: 'Ocupado', 
        nome_cliente: formData.nome, 
        contato_cliente: `${formData.email} | ${formData.telefone}`, 
        assunto: formData.assunto
      });

      if (sheetResult) {
        if (rescheduleData.active && rescheduleData.eventId) {
           setProgressData(p => ({...p, message: "A remover agendamento antigo..."}));
           setEvents(prev => prev.filter(ev => ev.id !== rescheduleData.eventId));
           const oldSlot = safeSlots.find(s => s.contato_cliente && s.contato_cliente.includes(rescheduleData.oldEmail) && s.status === 'Ocupado' && s.id !== selectedSlotForBooking.id);
           
           if (oldSlot) {
             setSlots(prev => prev.map(s => s.id === oldSlot.id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '', assunto: '' } : s));
             await callN8N('update_slot', { 
               id: oldSlot.id, 
               data: oldSlot.data || '',
               horario: oldSlot.horario || '',
               atendente: oldSlot.atendente || oldSlot.Atendente || '',
               status: 'Livre', 
               nome_cliente: '', 
               contato_cliente: '', 
               assunto: '' 
             });
           }

           await callN8N('delete', { eventId: rescheduleData.eventId });
           setRescheduleData({ active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: '' });
           showToast(`Remarcação confirmada!`, "success");
        } else {
           showToast(`Agendamento confirmado!`, "success"); 
        }

        setSelectedSlotForBooking(null);
        setFormData({ nome: '', email: '', telefone: '', assunto: '' });
      } else { setSlots(previousSlots); showToast(`Erro ao gravar dados.`, "error"); }
    } else { setSlots(previousSlots); showToast(`Erro ao criar no calendário.`, "error"); }

    setProgressData({ active: false, current: 0, total: 0, message: '' });
    setLoading(false);
    fetchData();
  };

  const getDatesInRange = (start, end, weekdays) => {
    let current = new Date(start + 'T12:00:00');
    const endDate = new Date(end + 'T12:00:00');
    const dates = [];
    while (current <= endDate) {
      if (weekdays.includes(current.getDay())) {
        dates.push(current.toISOString().split('T')[0]);
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const handleAddAtendenteToMassSlot = () => {
    if (newAtendente.trim()) {
      if (!slotData.atendentes.includes(newAtendente.trim())) {
        setSlotData(p => ({...p, atendentes: [...p.atendentes, newAtendente.trim()]}));
      }
      setNewAtendente('');
    }
  };

  const handleCreateMassSlots = async (e) => {
    e.preventDefault();
    if (!slotData.startDate) return showToast("Selecione a Data Inicial.", "error");
    if (slotData.atendentes.length === 0) return showToast("Adicione pelo menos um atendente!", "error");
    if (slotData.times.length === 0) return showToast("Selecione pelo menos um horário!", "error");
    
    const datesToProcess = slotData.endDate 
      ? getDatesInRange(slotData.startDate, slotData.endDate, slotData.weekdays) 
      : [slotData.startDate];

    if (datesToProcess.length === 0) {
      return showToast("Nenhum dia válido encontrado. Verifique os dias da semana.", "error");
    }
    
    const totalTasks = datesToProcess.length * slotData.times.length * slotData.atendentes.length;
    let sucessos = 0;
    
    setIsSlotModalOpen(false); 
    setLoading(true);
    
    setProgressData({ active: true, current: 0, total: totalTasks, message: 'A criar vagas no sistema...' });
    
    for (const dateIso of datesToProcess) {
      const parts = dateIso.split('-');
      const formattedData = `${parts[2]}/${parts[1]}/${parts[0]}`; 
      
      for (const time of slotData.times) {
        for (const atendente of slotData.atendentes) {
          sucessos++;
          setProgressData(prev => ({ ...prev, current: sucessos }));
          
          await callN8N('create_slot', { 
            data: formattedData, 
            horario: time,
            atendente: atendente,
            status: 'Livre',
            nome_cliente: '',
            contato_cliente: '',
            assunto: ''
          });
        }
      }
    }
    
    setProgressData({ active: false, current: 0, total: 0, message: '' });
    showToast(`${sucessos} vagas geradas com sucesso!`, "success"); 
    setSlotData({ startDate: todayStr, endDate: '', weekdays: [1, 2, 3, 4, 5], times: [], atendentes: [] });
    setLoading(false);
    fetchData(); 
  };

  const handleUpdateAtendente = async (e) => {
    e.preventDefault();
    if (!editAtendenteModal.slotId) return;
    
    setLoading(true);
    const slotToUpdate = safeSlots.find(s => s.id === editAtendenteModal.slotId);
    if (!slotToUpdate) {
      setLoading(false);
      return showToast("Vaga não encontrada.", "error");
    }

    const previousSlots = [...safeSlots];
    // Atualiza otimista na tela
    setSlots(prev => prev.map(s => s.id === editAtendenteModal.slotId ? { ...s, atendente: editAtendenteModal.currentName, Atendente: editAtendenteModal.currentName } : s));
    
    setProgressData({ active: true, current: 0, total: 1, message: 'A atualizar atendente...' });
    
    // Passando todos os campos para não apagar o assunto nem nada
    const res = await callN8N('update_slot', { 
      id: slotToUpdate.id, 
      data: slotToUpdate.data || '',
      horario: slotToUpdate.horario || '',
      atendente: editAtendenteModal.currentName,
      status: slotToUpdate.status || 'Livre', 
      nome_cliente: slotToUpdate.nome_cliente || '', 
      contato_cliente: slotToUpdate.contato_cliente || '',
      assunto: slotToUpdate.assunto || ''
    });

    setProgressData({ active: false, current: 0, total: 0, message: '' });
    
    if (res) {
      showToast("Atendente atualizado com sucesso!", "success");
      setEditAtendenteModal({ isOpen: false, slotId: null, currentName: '' });
    } else {
      setSlots(previousSlots);
      showToast("Erro ao atualizar atendente na planilha.", "error");
    }
    setLoading(false);
    fetchData();
  };

  const toggleTimeSelection = (time) => {
    setSlotData(prev => ({
      ...prev, 
      times: prev.times.includes(time) ? prev.times.filter(t => t !== time) : [...prev.times, time].sort()
    }));
  };

  const toggleWeekday = (id) => {
    setSlotData(prev => ({
      ...prev,
      weekdays: prev.weekdays.includes(id) ? prev.weekdays.filter(d => d !== id) : [...prev.weekdays, id]
    }));
  };

  const handleDelete = async (id, type) => {
    if (!id) return;
    setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' }); 

    const prevEvents = [...safeEvents];
    const prevSlots = [...safeSlots];
    setLoading(true);
    setProgressData({ active: true, current: 0, total: 1, message: 'A processar exclusão...' });

    if (type === 'event') {
      const eventToDelete = safeEvents.find(e => e.id === id);
      const eventEmail = eventToDelete?.attendees?.[0]?.email;

      setEvents(prev => prev.filter(e => e.id !== id));
      
      const res = await callN8N('delete', { eventId: id });
      if (!res) { 
        setEvents(prevEvents); setLoading(false); setProgressData({active:false, current:0, total:0, message:''}); return; 
      }

      if (eventEmail) {
        const matchingSlot = safeSlots.find(s => s.contato_cliente && s.contato_cliente.includes(eventEmail) && s.status === 'Ocupado');
        if (matchingSlot) {
          setSlots(prev => prev.map(s => s.id === matchingSlot.id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '', assunto: '' } : s));
          await callN8N('update_slot', { 
            id: matchingSlot.id, 
            data: matchingSlot.data || '',
            horario: matchingSlot.horario || '',
            atendente: matchingSlot.atendente || matchingSlot.Atendente || '',
            status: 'Livre', 
            nome_cliente: '', 
            contato_cliente: '', 
            assunto: '' 
          });
        }
      }
      showToast("Cancelado com sucesso!");

    } else if (type === 'slot') {
      const slotToDelete = safeSlots.find(s => s.id === id);

      if (slotToDelete?.status === 'Ocupado') {
        setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'Livre', nome_cliente: '', contato_cliente: '', assunto: '' } : s));
        
        const res = await callN8N('update_slot', { 
          id: id, 
          data: slotToDelete.data || '',
          horario: slotToDelete.horario || '',
          atendente: slotToDelete.atendente || slotToDelete.Atendente || '',
          status: 'Livre', 
          nome_cliente: '', 
          contato_cliente: '', 
          assunto: '' 
        });

        if (!res) { setSlots(prevSlots); setLoading(false); setProgressData({active:false, current:0, total:0, message:''}); return; }

        const matchingEvent = safeEvents.find(e => e.attendees?.[0]?.email && slotToDelete.contato_cliente && slotToDelete.contato_cliente.includes(e.attendees[0].email));
        if (matchingEvent) {
          setEvents(prev => prev.filter(e => e.id !== matchingEvent.id));
          await callN8N('delete', { eventId: matchingEvent.id });
        }
        showToast("Vaga libertada!");
      } else {
        setSlots(prev => prev.map(s => s.id === id ? { ...s, status: 'Excluído' } : s));
        
        const res = await callN8N('delete_slot', { id });
        if (!res) { setSlots(prevSlots); setLoading(false); setProgressData({active:false, current:0, total:0, message:''}); return; } 
        showToast("Vaga removida da grelha.");
      }
    }
    setProgressData({ active: false, current: 0, total: 0, message: '' });
    setLoading(false);
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
      if (!s) return "Sem data definida";
      const d = new Date(s);
      if (isNaN(d.getTime())) return "Data inválida";
      return d.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch { return "Erro"; }
  };

  const isSearching = searchTerm.trim().length > 0;

  const filteredEvents = safeEvents.filter(e => {
    if (!e || typeof e !== 'object' || e.status === 'cancelled') return false;
    
    const search = String(searchTerm || '').toLowerCase();
    const summary = String(e.summary || '').toLowerCase();
    const matchesSearch = summary.includes(search);
    
    let eventDate = '';
    if (e.start?.dateTime) eventDate = String(e.start.dateTime).split('T')[0];
    else if (e.start?.date) eventDate = String(e.start.date);
    
    if (isSearching) return matchesSearch;
    return eventDate === activeDate;
  });

  const filteredSlots = safeSlots.filter(s => {
    if (!s || typeof s !== 'object' || s.status === 'Excluído') return false;
    
    const search = String(searchTerm || '').toLowerCase();
    const matchesSearch = String(s.horario || '').includes(search) || 
                          String(s.nome_cliente || '').toLowerCase().includes(search) || 
                          String(s.atendente || s.Atendente || '').toLowerCase().includes(search) ||
                          String(s.contato_cliente || '').toLowerCase().includes(search) ||
                          String(s.assunto || '').toLowerCase().includes(search);
                          
    const parts = String(s.data || '').split('/');
    const slotIso = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
    
    if (isSearching) return matchesSearch;
    return slotIso === activeDate;
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
      
      {/* HEADER */}
      <header className={`sticky top-0 z-40 w-full backdrop-blur-xl border-b transition-colors duration-300 ${darkMode ? 'bg-slate-950/80 border-slate-800 shadow-xl shadow-black/20' : 'bg-white/90 border-slate-200 shadow-sm'}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-5 py-4 sm:py-5 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-white shadow-lg shadow-indigo-500/30">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />
            </div>
            <h1 className="font-black text-xl sm:text-2xl tracking-tight hidden min-[360px]:block">Agenda descolada</h1>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => {fetchData(); showToast("A atualizar...");}} className={`p-2 sm:p-2.5 rounded-full transition-colors ${darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}>
              <RefreshCw className={`w-5 h-5 sm:w-6 sm:h-6 ${loading ? 'animate-spin text-indigo-500' : ''}`} />
            </button>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 sm:p-2.5 rounded-full transition-colors ${darkMode ? 'text-amber-400 hover:bg-slate-800' : 'text-indigo-600 hover:bg-slate-100'}`}>
              {darkMode ? <Sun className="w-5 h-5 sm:w-6 sm:h-6" /> : <Moon className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          </div>
        </div>

        <div className="max-w-md mx-auto px-4 pb-4 flex gap-2 mt-1">
          <button onClick={() => setView('sheets')} className={`flex-1 py-2.5 sm:py-3 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 ${view === 'sheets' ? (darkMode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-white shadow-lg shadow-slate-800/20') : (darkMode ? 'bg-slate-900 text-slate-400 hover:bg-slate-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}>
            Vagas
          </button>
          <button onClick={() => setView('calendar')} className={`flex-1 py-2.5 sm:py-3 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 ${view === 'calendar' ? (darkMode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-white shadow-lg shadow-slate-800/20') : (darkMode ? 'bg-slate-900 text-slate-400 hover:bg-slate-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}>
            Eventos Agendados
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-5 sm:space-y-6 pb-32">
        
        {rescheduleData.active && (
          <div className={`p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg animate-in slide-in-from-top-4 ${darkMode ? 'bg-indigo-900/40 border border-indigo-500/30' : 'bg-indigo-50 border border-indigo-200'}`}>
             <div className="flex items-center gap-3 sm:gap-4">
                <div className={`p-2 rounded-full shrink-0 ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-200 text-indigo-700'}`}>
                  <Info size={20} />
                </div>
                <div>
                  <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Modo Remarcação</p>
                  <p className={`font-semibold text-xs sm:text-sm ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                    Escolha a nova vaga para <strong className="font-black">{rescheduleData.oldName || rescheduleData.oldEmail}</strong>
                  </p>
                </div>
             </div>
             <button onClick={() => setRescheduleData({active: false, eventId: null, oldName: '', oldEmail: '', oldPhone: ''})} className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors w-full sm:w-auto shadow-sm ${darkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
               Cancelar
             </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3 sm:gap-4 justify-between items-stretch bg-transparent w-full">
          
          <div className={`flex items-center justify-between gap-1 sm:gap-2 p-1.5 sm:p-2 rounded-2xl w-full md:w-auto transition-opacity duration-300 ${isSearching ? 'opacity-30 pointer-events-none' : 'opacity-100'} ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200 shadow-sm'}`}>
            <button onClick={() => shiftDate(-1)} className={`p-2 sm:p-3 rounded-xl shrink-0 transition-colors ${darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}>
              <ChevronLeft size={20} className="sm:w-6 sm:h-6" />
            </button>
            
            <div className="flex-1 text-center flex flex-col justify-center min-w-[100px] sm:min-w-[140px] relative">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-0.5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Exibindo</span>
              <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                 <span className={`font-black text-sm sm:text-lg ${darkMode ? 'text-white' : 'text-slate-800'}`}>{getDisplayDateLabel()}</span>
                 <label className="cursor-pointer relative overflow-hidden group shrink-0">
                   <CalendarDays size={16} className={`sm:w-5 sm:h-5 transition-colors ${darkMode ? 'text-indigo-400 group-hover:text-indigo-300' : 'text-indigo-600 group-hover:text-indigo-800'}`} />
                   <input type="date" value={activeDate} onChange={e => setActiveDate(e.target.value)} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
                 </label>
              </div>
            </div>

            <button onClick={() => shiftDate(1)} className={`p-2 sm:p-3 rounded-xl shrink-0 transition-colors ${darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}>
              <ChevronRight size={20} className="sm:w-6 sm:h-6" />
            </button>
            
            {activeDate !== todayStr && (
              <button onClick={() => setActiveDate(todayStr)} className={`shrink-0 ml-1 sm:ml-2 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors ${darkMode ? 'bg-indigo-900/40 text-indigo-400 hover:bg-indigo-900/60' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
                Hoje
              </button>
            )}
          </div>

          <div className="flex gap-2 sm:gap-3 w-full md:w-auto flex-1 lg:max-w-md">
            <div className="relative flex-1 min-w-0">
              <Search className={`absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
              <input placeholder={`Buscar pessoa...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} 
                     className={`w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-xs sm:text-sm font-semibold outline-none transition-all ${darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder-slate-500 focus:border-indigo-500' : 'bg-white border-slate-200 text-slate-800 focus:border-indigo-400 shadow-sm'}`} />
            </div>
            
            {view === 'sheets' && (
              <button onClick={() => setIsSlotModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 active:scale-95">
                <Plus size={20} strokeWidth={3} /> <span className="hidden sm:inline">Gerar Vagas</span>
              </button>
            )}
          </div>
        </div>

        {view === 'sheets' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredSlots.length === 0 && !loading && (
               <div className="col-span-full text-center py-16 sm:py-20 animate-in fade-in">
                 <FileText size={48} className={`mx-auto mb-4 sm:w-14 sm:h-14 ${darkMode ? 'text-slate-800' : 'text-slate-200'}`} />
                 <p className={`font-semibold text-base sm:text-lg ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                   {isSearching ? 'Nenhuma vaga encontrada para esta pesquisa.' : 'O dia está vazio. Nenhuma vaga criada.'}
                 </p>
                 {!isSearching && (
                   <button onClick={() => setIsSlotModalOpen(true)} className="mt-4 sm:mt-6 font-bold text-indigo-500 hover:underline">Criar vagas para este dia</button>
                 )}
               </div>
            )}
            
            {filteredSlots.map((slot, index) => {
              const isLivre = slot?.status === 'Livre';
              const contactInfo = String(slot.contato_cliente || '');
              const [emailSlot, phoneSlot] = contactInfo.includes('|') ? contactInfo.split('|').map(s => s.trim()) : [contactInfo, ''];

              return (
                <div key={slot?.id ? String(slot.id) : `slot-${index}`} className={`rounded-2xl sm:rounded-3xl p-5 sm:p-6 border relative transition-all duration-300 group ${darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-100'}`}>
                  
                  <div className="flex justify-between items-start mb-4 sm:mb-5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={`p-2 sm:p-2.5 rounded-xl ${isLivre ? (darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600') : (darkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600')}`}>
                        <Clock size={20} strokeWidth={2.5} className="sm:w-6 sm:h-6" />
                      </div>
                      <span className={`font-black text-2xl sm:text-3xl tracking-tight ${darkMode ? 'text-white' : 'text-slate-800'}`}>{String(slot?.horario || '--:--')}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className={`text-[9px] sm:text-[10px] font-black px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg uppercase tracking-widest ${isLivre ? (darkMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border border-emerald-200') : (darkMode ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-orange-100 text-orange-700 border border-orange-200')}`}>
                        {String(slot?.status || 'N/D')}
                      </span>
                      <button onClick={() => setDeleteConfirm({ isOpen: true, id: slot?.id, title: `${slot?.data} às ${slot?.horario}`, type: 'slot' })} className={`p-1.5 sm:p-2 rounded-lg transition-colors ${darkMode ? 'text-slate-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}>
                        <Trash2 size={16} className="sm:w-5 sm:h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2.5 sm:space-y-3 mb-5 sm:mb-6">
                    {isSearching && (
                      <div className={`flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-black ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                        <Calendar size={16} className="sm:w-5 sm:h-5 shrink-0" /> <span className="truncate">{String(slot?.data || '--/--/----')}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between group/atendente">
                      <div className={`flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-bold ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                        <Briefcase size={16} className={`sm:w-5 sm:h-5 shrink-0 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} /> 
                        <span className="truncate">{String(slot?.atendente || slot?.Atendente || 'Balcão')}</span>
                      </div>
                      <button 
                        onClick={() => setEditAtendenteModal({ isOpen: true, slotId: slot.id, currentName: String(slot?.atendente || slot?.Atendente || '') })}
                        className={`p-1.5 rounded-lg opacity-100 sm:opacity-0 sm:group-hover/atendente:opacity-100 transition-all ${darkMode ? 'bg-slate-800 text-indigo-400 hover:bg-slate-700' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                        title="Alterar Atendente"
                      >
                        <Pencil size={14} className="sm:w-4 sm:h-4" />
                      </button>
                    </div>
                    
                    {!isLivre && slot?.nome_cliente && (
                      <div className={`pt-3 sm:pt-4 mt-3 sm:mt-4 border-t space-y-2 sm:space-y-3 ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                        <div className={`flex items-center gap-2 sm:gap-3 font-black text-sm sm:text-base ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                          <User size={16} className={`sm:w-5 sm:h-5 shrink-0 ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                          <span className="truncate">{String(slot.nome_cliente)}</span>
                        </div>
                        {phoneSlot && phoneSlot !== 'Não informado' && phoneSlot !== 'undefined' && (
                          <div className={`flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            <Phone size={14} className="sm:w-4 sm:h-4 shrink-0 opacity-70" />
                            <span className="truncate">{phoneSlot}</span>
                          </div>
                        )}
                        {slot?.assunto && (
                          <div className={`flex items-start gap-2 sm:gap-3 text-xs sm:text-sm font-semibold mt-1 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            <FileText size={14} className="sm:w-4 sm:h-4 shrink-0 opacity-70 mt-0.5" />
                            <span className="line-clamp-2">{String(slot.assunto)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isLivre && (
                    <button onClick={() => handleOpenBookingModal(slot)} className={`w-full py-3 sm:py-4 rounded-xl font-black text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${rescheduleData.active ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 animate-pulse' : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/30'}`}>
                      {rescheduleData.active ? 'Confirmar Remarcação' : 'Agendar Atendimento'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {view === 'calendar' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredEvents.length === 0 && !loading && (
               <div className="col-span-full text-center py-16 sm:py-20 animate-in fade-in">
                 <Calendar size={48} className={`mx-auto mb-4 sm:w-14 sm:h-14 ${darkMode ? 'text-slate-800' : 'text-slate-200'}`} />
                 <p className={`font-semibold text-base sm:text-lg ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                   {isSearching ? 'Nenhum agendamento oficial encontrado.' : 'Agenda livre neste dia.'}
                 </p>
               </div>
            )}

            {filteredEvents.map((event, index) => {
              const details = extractEventDetails(event);
              const isRemarcacao = details.assunto.toLowerCase().includes('remarcação');

              // Busca a vaga correspondente para exibir o Atendente
              const eventDateStr = event.start?.dateTime ? String(event.start.dateTime).split('T')[0] : String(event.start?.date);
              const associatedSlot = safeSlots.find(s => {
                if (!s.contato_cliente || details.email === 'Não informado' || s.status !== 'Ocupado') return false;
                const parts = String(s.data || '').split('/');
                const slotIso = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
                return s.contato_cliente.includes(details.email) && slotIso === eventDateStr;
              });

              return (
                <div key={event?.id ? String(event.id) : `event-${index}`} className={`rounded-2xl sm:rounded-3xl p-5 sm:p-6 border relative transition-all duration-300 ${darkMode ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-100'}`}>
                  
                  <div className={`absolute left-0 top-5 sm:top-6 bottom-5 sm:bottom-6 w-1.5 rounded-r-md ${isRemarcacao ? 'bg-amber-500' : 'bg-indigo-500'}`}></div>

                  <div className="flex justify-between items-start mb-3 sm:mb-4 pl-3 sm:pl-4">
                    <h3 className={`font-black text-lg sm:text-xl leading-tight pr-14 break-words line-clamp-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                      {details.assunto}
                    </h3>
                    
                    <div className="absolute top-4 sm:top-5 right-4 sm:right-5 flex gap-1">
                      <button onClick={() => setEventDetailsModal(event)} className={`p-2 sm:p-2.5 rounded-xl transition-colors ${darkMode ? 'text-indigo-400 hover:text-white hover:bg-slate-800' : 'text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50'}`} title="Ver Detalhes">
                        <Eye size={18} className="sm:w-5 sm:h-5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ isOpen: true, id: event?.id, title: details.assunto, type: 'event' })} className={`p-2 sm:p-2.5 rounded-xl transition-colors ${darkMode ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`} title="Remover / Remarcar">
                        <Trash2 size={18} className="sm:w-5 sm:h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2.5 sm:space-y-3 mt-4 sm:mt-5 pl-3 sm:pl-4">
                    {associatedSlot && (
                      <div className={`flex items-center justify-between group/atendente pb-2 mb-2 border-b border-dashed ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                        <div className={`flex items-center gap-2 sm:gap-3 font-bold text-xs sm:text-sm ${darkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>
                          <Briefcase size={16} className={`sm:w-4 sm:h-4 shrink-0`} /> 
                          <span className="truncate">{String(associatedSlot.atendente || associatedSlot.Atendente || 'Balcão')}</span>
                        </div>
                        <button 
                          onClick={() => setEditAtendenteModal({ isOpen: true, slotId: associatedSlot.id, currentName: String(associatedSlot.atendente || associatedSlot.Atendente || '') })}
                          className={`p-1.5 rounded-lg opacity-100 sm:opacity-0 sm:group-hover/atendente:opacity-100 transition-all ${darkMode ? 'bg-slate-800 text-indigo-400 hover:bg-slate-700' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                          title="Alterar Atendente"
                        >
                          <Pencil size={14} className="sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    )}
                    
                    {details.nome && details.nome !== details.assunto && (
                      <div className={`flex items-center gap-2 sm:gap-3 font-bold text-xs sm:text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                        <User size={16} className={`sm:w-4 sm:h-4 shrink-0 ${darkMode ? 'text-indigo-400' : 'text-indigo-500'}`} /> <span className="truncate">{details.nome}</span>
                      </div>
                    )}
                    <div className={`flex items-center gap-2 sm:gap-3 font-semibold text-xs sm:text-sm ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                      <Clock size={16} className={`sm:w-4 sm:h-4 shrink-0 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} /> 
                      {details.data}
                    </div>
                    {details.telefone && details.telefone !== 'Não informado' && (
                      <div className={`flex items-center gap-2 sm:gap-3 font-medium text-xs sm:text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Phone size={16} className="sm:w-4 sm:h-4 shrink-0 opacity-70" /> <span className="truncate">{details.telefone}</span>
                      </div>
                    )}
                    {details.email && details.email !== 'Não informado' && (
                      <div className={`flex items-center gap-2 sm:gap-3 font-medium text-xs sm:text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Mail size={16} className="sm:w-4 sm:h-4 shrink-0 opacity-70" /> <span className="truncate">{details.email}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* BLOQUEIO TOTAL E PROGRESSO DE CARREGAMENTO */}
      {progressData.active && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <Loader2 size={48} className="sm:w-16 sm:h-16 text-indigo-500 animate-spin mb-6 sm:mb-8" />
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">{progressData.message}</h2>
          {progressData.total > 1 && (
            <div className="w-full max-w-sm mt-4 sm:mt-6">
              <div className="flex justify-between text-slate-400 text-sm sm:text-base font-bold mb-2">
                <span>Progresso</span>
                <span>{progressData.current} de {progressData.total}</span>
              </div>
              <div className="h-2 sm:h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300 rounded-full" 
                  style={{ width: `${(progressData.current / progressData.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}
          <p className="text-slate-500 mt-6 sm:mt-8 text-xs sm:text-sm font-semibold max-w-sm px-4">
            Aguarde. Por favor, não feche nem recarregue a página até que o processo seja concluído.
          </p>
        </div>
      )}

      {/* MODAL FICHA RESUMO */}
      {eventDetailsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div className={`w-full max-w-md p-6 sm:p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className={`flex justify-between items-start mb-5 sm:mb-6 pb-4 sm:pb-6 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <h2 className={`font-black text-xl sm:text-2xl flex items-center gap-2 sm:gap-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                <FileText size={24} className="sm:w-7 sm:h-7 text-indigo-500 shrink-0"/> Ficha Resumo
              </h2>
              <button onClick={() => setEventDetailsModal(null)} className={`p-2 rounded-full transition-colors shrink-0 ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <div className="space-y-5 sm:space-y-6">
              <div>
                <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1.5 sm:mb-2 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>Assunto / Motivo</p>
                <p className={`text-lg sm:text-xl font-black leading-relaxed whitespace-pre-wrap break-words ${darkMode ? 'text-slate-100' : 'text-slate-800'}`}>{extractEventDetails(eventDetailsModal).assunto}</p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-3 sm:pt-4">
                <div>
                  <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Clock size={12} className="sm:w-3.5 sm:h-3.5"/> Horário</p>
                  <p className={`font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).data}</p>
                </div>
                <div>
                  <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><User size={12} className="sm:w-3.5 sm:h-3.5"/> Solicitante</p>
                  <p className={`font-bold text-sm break-words ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).nome || 'Não consta'}</p>
                </div>
                <div>
                  <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Phone size={12} className="sm:w-3.5 sm:h-3.5"/> Telefone</p>
                  <p className={`font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).telefone}</p>
                </div>
                <div>
                  <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-1 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><Mail size={12} className="sm:w-3.5 sm:h-3.5"/> E-mail</p>
                  <p className={`font-bold text-sm break-words ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{extractEventDetails(eventDetailsModal).email}</p>
                </div>
              </div>
            </div>
            
            <button onClick={() => setEventDetailsModal(null)} className={`w-full mt-8 sm:mt-10 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black text-sm transition-colors active:scale-95 ${darkMode ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>Fechar Ficha</button>
          </div>
        </div>
      )}

      {/* MODAL: GERADOR EM MASSA DE VAGAS */}
      {isSlotModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-xl p-6 sm:p-8 sm:rounded-[2.5rem] rounded-t-[2rem] shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto overscroll-contain ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className="flex justify-between items-start sm:items-center mb-6 sm:mb-8 sticky top-0 bg-inherit z-10 pt-2 pb-3 sm:py-2">
              <div>
                <h2 className={`font-black text-2xl sm:text-3xl mb-1 ${darkMode ? 'text-white' : 'text-slate-800'}`}>Gerador de Vagas</h2>
                <p className={`text-xs sm:text-sm font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Crie múltiplos horários de uma vez</p>
              </div>
              <button onClick={() => setIsSlotModalOpen(false)} className={`p-2 rounded-full transition-colors shrink-0 ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleCreateMassSlots} className="space-y-5 sm:space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>A Partir Da Data</label>
                  <input required type="date" className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} value={slotData.startDate} onChange={e => setSlotData({...slotData, startDate: e.target.value})} />
                </div>
                <div>
                  <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider flex items-center gap-1 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}><Repeat size={12} className="sm:w-3.5 sm:h-3.5"/> Até Data (Opcional)</label>
                  <input type="date" min={slotData.startDate} className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} value={slotData.endDate} onChange={e => setSlotData({...slotData, endDate: e.target.value})} />
                </div>
              </div>

              {slotData.endDate && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-2 sm:mb-3 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Repetir apenas nos dias:</label>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {WEEKDAYS.map(day => {
                      const isSelected = slotData.weekdays.includes(day.id);
                      return (
                        <button 
                          key={day.id} 
                          type="button" 
                          onClick={() => toggleWeekday(day.id)}
                          className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 ${isSelected ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : (darkMode ? 'bg-slate-800 text-slate-500 hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              <div>
                <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider flex justify-between items-center ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Atendentes (Múltiplos)</span>
                  <span className="text-indigo-500">{slotData.atendentes.length} adicionado(s)</span>
                </label>
                
                <div className="flex gap-2">
                  <input 
                    list="atendentes-list" 
                    placeholder="Nome do atendente e Enter..." 
                    className={`flex-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-bold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} 
                    value={newAtendente} 
                    onChange={e => setNewAtendente(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault(); // Impede o envio do formulário
                        handleAddAtendenteToMassSlot();
                      }
                    }}
                  />
                  <button 
                    type="button" 
                    onClick={handleAddAtendenteToMassSlot}
                    className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-4 sm:px-5 rounded-xl sm:rounded-2xl font-bold transition-colors dark:bg-indigo-500/20 dark:text-indigo-400 dark:hover:bg-indigo-500/30 flex items-center justify-center shrink-0"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                
                <datalist id="atendentes-list">
                  {uniqueAtendentes.map((nome, i) => <option key={`atendente-${i}`} value={nome} />)}
                </datalist>

                {slotData.atendentes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 animate-in fade-in">
                    {slotData.atendentes.map(atendente => (
                      <div key={atendente} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-white border border-slate-200 shadow-sm text-slate-700'}`}>
                        <Briefcase size={14} className="opacity-50" />
                        <span>{atendente}</span>
                        <button 
                          type="button" 
                          onClick={() => setSlotData(p => ({...p, atendentes: p.atendentes.filter(a => a !== atendente)}))}
                          className="ml-1 p-0.5 rounded-md hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div>
                <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-2 sm:mb-3 ml-1 tracking-wider flex justify-between items-center ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Selecione os Horários</span>
                  <span className="text-indigo-500">{slotData.times.length} selecionado(s)</span>
                </label>
                
                <div className="grid grid-cols-3 min-[400px]:grid-cols-4 sm:grid-cols-5 gap-2 max-h-[160px] sm:max-h-[200px] overflow-y-auto p-1">
                  {PREDEFINED_TIMES.map(time => {
                    const isSelected = slotData.times.includes(time);
                    return (
                      <button 
                        key={time} 
                        type="button" 
                        onClick={() => toggleTimeSelection(time)}
                        className={`py-2 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-black transition-all duration-200 ${isSelected ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30 scale-105' : (darkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}`}
                      >
                        {time}
                      </button>
                    )
                  })}
                </div>
                
                <div className="flex justify-end mt-2">
                   <button type="button" onClick={() => setSlotData(p => ({...p, times: []}))} className={`text-[10px] sm:text-xs font-bold ${darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}>Limpar Seleção</button>
                </div>
              </div>

              <button disabled={loading || slotData.times.length === 0 || slotData.atendentes.length === 0} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black text-sm sm:text-lg mt-2 sm:mt-4 shadow-lg shadow-indigo-600/30 transition-all flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100">
                {loading ? <Loader2 className="animate-spin" size={20} /> : `Gerar Vagas (${slotData.times.length * slotData.atendentes.length * (slotData.endDate ? getDatesInRange(slotData.startDate, slotData.endDate, slotData.weekdays).length : 1)} no total)`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR ATENDENTE */}
      {editAtendenteModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm p-6 sm:p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200 border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className="flex justify-between items-center mb-6">
              <h3 className={`font-black text-xl ${darkMode ? 'text-white' : 'text-slate-800'}`}>Alterar Atendente</h3>
              <button onClick={() => setEditAtendenteModal({isOpen: false, slotId: null, currentName: ''})} className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20}/></button>
            </div>
            <form onSubmit={handleUpdateAtendente} className="space-y-5">
              <div>
                <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Nome do Atendente</label>
                <input 
                  autoFocus
                  required 
                  list="atendentes-list-edit"
                  placeholder="Nome do atendente..."
                  className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500 focus:bg-white'}`} 
                  value={editAtendenteModal.currentName} 
                  onChange={e => setEditAtendenteModal({...editAtendenteModal, currentName: e.target.value})} 
                />
                <datalist id="atendentes-list-edit">
                  {uniqueAtendentes.map((nome, i) => <option key={`edit-atendente-${i}`} value={nome} />)}
                </datalist>
              </div>
              <button disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3.5 rounded-xl font-black text-sm transition-all flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={20} /> : 'Salvar Alteração'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REALIZAR AGENDAMENTO */}
      {isModalOpen && selectedSlotForBooking && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md p-6 sm:p-8 sm:rounded-[2.5rem] rounded-t-[2rem] shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto overscroll-contain ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            <div className="flex justify-between items-start sm:items-center mb-6 sm:mb-8 sticky top-0 bg-inherit z-10 pt-2 pb-3 sm:py-2">
              <div>
                <h2 className={`font-black text-xl sm:text-2xl mb-1 sm:mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{rescheduleData.active ? 'Nova Data' : 'Agendar'}</h2>
                <p className={`text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  <Calendar size={14} className="sm:w-4 sm:h-4" /> {String(selectedSlotForBooking.data || '')} às {String(selectedSlotForBooking.horario || '')}
                </p>
                <p className={`text-[10px] sm:text-xs mt-1 sm:mt-2 flex items-center gap-1.5 sm:gap-2 font-semibold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <Briefcase size={12} className="sm:w-3.5 sm:h-3.5" /> Atendente: {String(selectedSlotForBooking.atendente || 'Balcão')}
                </p>
              </div>
              <button onClick={() => {setIsModalOpen(false); setSelectedSlotForBooking(null)}} className={`p-2 rounded-full transition-colors shrink-0 ${darkMode ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmitBooking} className="space-y-4 sm:space-y-5">
              <div>
                <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Nome Completo</label>
                <input required placeholder="Ex: Yan Gomes" className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Telefone</label>
                  <input required placeholder="(95) 90000-0000" className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} 
                         value={formData.telefone} 
                         onChange={e => setFormData({...formData, telefone: formatPhone(e.target.value)})} />
                </div>
                <div>
                  <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>E-mail</label>
                  <input required type="email" placeholder="@tjrr.jus.br" className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-semibold outline-none transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>
              
              <div>
                <label className={`block text-[10px] sm:text-xs font-bold uppercase mb-1.5 sm:mb-2 ml-1 tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Assunto / Motivo</label>
                <textarea required rows="2" placeholder="Descreva brevemente..." className={`w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl sm:rounded-2xl border text-sm sm:text-base font-semibold outline-none transition-all resize-none ${darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white'}`} value={formData.assunto} onChange={e => setFormData({...formData, assunto: e.target.value})} />
              </div>
              
              <button disabled={loading} className={`w-full text-white py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black text-sm sm:text-lg mt-2 sm:mt-4 shadow-lg transition-all flex justify-center items-center gap-2 active:scale-95 ${rescheduleData.active ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30' : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/30'}`}>
                {loading ? <Loader2 className="animate-spin" size={20} /> : (rescheduleData.active ? 'Finalizar Remarcação' : 'Confirmar e Enviar')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMAÇÃO EXCLUIR / REMARCAR */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm p-6 sm:p-8 rounded-[2rem] shadow-2xl text-center animate-in zoom-in-95 duration-200 border max-h-[90vh] overflow-y-auto ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-white'}`}>
            
            {deleteConfirm.type === 'event' ? (
              <>
                <div className={`p-4 sm:p-5 rounded-full inline-block mb-4 sm:mb-6 ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}><RefreshCw size={28} className="sm:w-9 sm:h-9" /></div>
                <h3 className={`font-black text-xl sm:text-2xl mb-2 sm:mb-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>Gerir Agendamento</h3>
                <p className={`text-xs sm:text-sm font-medium mb-6 sm:mb-8 px-2 break-words line-clamp-3 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>O que deseja fazer com <strong className={darkMode ? 'text-slate-300' : 'text-slate-700'}>"{String(deleteConfirm.title)}"</strong>?</p>
                <div className="flex flex-col gap-2.5 sm:gap-3">
                  <button onClick={handleReschedule} disabled={loading} className="w-full py-3 sm:py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95">
                    Remarcar Data
                  </button>
                  <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className={`w-full py-3 sm:py-4 rounded-xl font-bold text-xs sm:text-sm transition-all ${darkMode ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                    Cancelar Definitivamente
                  </button>
                  <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`w-full py-2.5 sm:py-3 rounded-xl font-bold text-xs sm:text-sm transition-all mt-1 sm:mt-2 ${darkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-300' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                    Voltar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={`p-4 sm:p-5 rounded-full inline-block mb-4 sm:mb-6 ${darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'}`}><Trash2 size={28} className="sm:w-9 sm:h-9" /></div>
                <h3 className={`font-black text-xl sm:text-2xl mb-2 sm:mb-3 ${darkMode ? 'text-white' : 'text-slate-800'}`}>Excluir Vaga?</h3>
                <p className={`text-xs sm:text-sm font-medium mb-6 sm:mb-8 px-2 break-words line-clamp-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{String(deleteConfirm.title)}</p>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteConfirm({ isOpen: false, id: null, title: '', type: 'event' })} className={`flex-1 py-3 sm:py-4 rounded-xl font-bold text-xs sm:text-sm transition-all ${darkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Manter</button>
                  <button onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.type)} disabled={loading} className="flex-1 py-3 sm:py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-red-600/30 transition-all active:scale-95">Excluir</button>
                </div>
              </>
            )}
            
          </div>
        </div>
      )}

      {/* TOAST FLUTUANTE */}
      {toast && (
        <div className={`fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 px-5 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl shadow-2xl z-[100] animate-in slide-in-from-top-4 flex items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-bold whitespace-nowrap border max-w-[90vw] overflow-hidden ${toast.type === 'error' ? (darkMode ? 'bg-red-950/90 text-red-400 border-red-900 shadow-red-900/50' : 'bg-red-50 text-red-600 border-red-200') : (toast.type === 'info' ? (darkMode ? 'bg-indigo-950/90 text-indigo-400 border-indigo-900' : 'bg-indigo-50 text-indigo-600 border-indigo-200') : (darkMode ? 'bg-emerald-950/90 text-emerald-400 border-emerald-900 shadow-emerald-900/50' : 'bg-emerald-50 text-emerald-600 border-emerald-200'))}`}>
          {toast.type === 'error' ? <AlertCircle size={18} className="shrink-0" /> : (toast.type === 'info' ? <Info size={18} className="shrink-0" /> : <Check size={18} className="shrink-0" />)}
          <span className="truncate">{toast.message}</span>
        </div>
      )}
    </div>
  );
}