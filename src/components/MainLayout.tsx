import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUser } from '../context';
import { rtcManager } from '../webrtc';
import { Contact } from '../types';
import { db, LocalMessage } from '../db';
import { decryptText } from '../crypto';
import ChatView from './ChatView';
import { UserPlus, Search, Trash2, Shield, Menu, LogOut, MessageSquare, Users, Settings, Copy, PhoneOutgoing, PhoneIncoming, PhoneCall, Phone, PhoneOff, ChevronDown, Maximize2, Radio } from 'lucide-react';

export default function MainLayout() {
  const { userId, logout, aesKey } = useUser();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [newContactId, setNewContactId] = useState('');
  const [newContactAlias, setNewContactAlias] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'settings'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCall, setActiveCall] = useState<{
    contactId: string;
    callId: string;
    callerName: string;
    status: 'incoming' | 'calling' | 'ongoing';
  } | null>(null);
  const [isGlobalCallMinimized, setIsGlobalCallMinimized] = useState(false);
  const [autoAnswerCallId, setAutoAnswerCallId] = useState<string | null>(null);
  const globalAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const syncAudio = (contactId?: string) => {
      const targetId = contactId || activeCall?.contactId;
      if (targetId && globalAudioRef.current) {
        const stream = rtcManager.callStreams.get(targetId);
        if (stream && globalAudioRef.current.srcObject !== stream) {
          globalAudioRef.current.srcObject = stream;
          globalAudioRef.current.play().catch(e => console.warn("Global audio play notice:", e?.message || e));
        }
      } else if (!activeCall && globalAudioRef.current) {
        globalAudioRef.current.srcObject = null;
      }
    };

    syncAudio();

    const unsubCall = rtcManager.onCall((contactId) => {
      syncAudio(contactId);
    });

    const unsubCallEnded = rtcManager.onCallEnded(() => {
      if (globalAudioRef.current) {
        globalAudioRef.current.srcObject = null;
      }
    });

    return () => {
      unsubCall();
      unsubCallEnded();
    };
  }, [activeCall?.contactId]);

  const chatData = useLiveQuery(
    async () => {
      const msgs = await db.messages.orderBy('timestamp').toArray();
      const counts: Record<string, number> = {};
      const lasts: Record<string, { message: LocalMessage, plainText: string }> = {};
      const allTexts: Record<string, string> = {};

      for (const m of msgs) {
        if (m.senderId === m.chatId && m.status !== 'read') {
          counts[m.chatId] = (counts[m.chatId] || 0) + 1;
        }
            
        // Always store the last one since we ordered by timestamp
        lasts[m.chatId] = { message: m, plainText: '' };
      }
          
      // Decrypt the last messages and all texts for search
      if (aesKey) {
        for (const chatId in lasts) {
          try {
            const m = lasts[chatId].message;
            if (m.type === 'text' && m.content) {
              lasts[chatId].plainText = await decryptText(m.content, aesKey);
            }
          } catch (e) {}
        }
        for (const m of msgs) {
          if (m.type === 'text' && m.content) {
            try {
              const plain = await decryptText(m.content, aesKey);
              if (!allTexts[m.chatId]) allTexts[m.chatId] = '';
              allTexts[m.chatId] += plain.toLowerCase() + ' ';
            } catch (e) {}
          }
        }
      }

      return { unreadCounts: counts, lastMessages: lasts, allTexts };
    },
    [aesKey]
  ) || { unreadCounts: {}, lastMessages: {}, allTexts: {} };
      
  const { unreadCounts, lastMessages, allTexts } = chatData;

  // Global message expiration check
  useEffect(() => {
    const checkExpirations = async () => {
      if (!userId) return;
      const msgs = await db.messages.toArray();
      const chatGroups = new Map<string, LocalMessage[]>();
          
      msgs.forEach(m => {
        if (!chatGroups.has(m.chatId)) chatGroups.set(m.chatId, []);
        chatGroups.get(m.chatId)!.push(m);
      });
          
      for (const [chatId, messages] of chatGroups.entries()) {
        const expiresInStr = localStorage.getItem(`ephemeral_${userId}_${chatId}`);
        const expiresIn = expiresInStr ? parseInt(expiresInStr, 10) : 0;
            
        if (expiresIn > 0 && messages.length > 0) {
          // Find the oldest message in this chat
          messages.sort((a, b) => a.timestamp - b.timestamp);
          const oldestMessage = messages[0];
          const chatExpiresAt = oldestMessage.timestamp + expiresIn * 60000;
              
          if (Date.now() >= chatExpiresAt) {
            // Delete all messages in this chat
            for (const m of messages) {
              if (m.fileId) await db.files.delete(m.fileId);
              await db.messages.delete(m.id);
            }
          }
        }
      }
    };

    const intervalId = setInterval(checkExpirations, 5000);
    return () => clearInterval(intervalId);
  }, [userId]);

  const fetchContacts = async () => {
    const list = await rtcManager.getContacts();
    setContacts(list);
  };

  useEffect(() => {
    if (activeContact) {
      const updated = contacts.find(c => c.contactId === activeContact.contactId);
      if (updated && (updated.mutual !== activeContact.mutual || updated.online !== activeContact.online || updated.alias !== activeContact.alias)) {
        setActiveContact(updated);
      }
    }
  }, [contacts, activeContact]);

  useEffect(() => {
    fetchContacts();
    
    const interval = setInterval(() => {
      fetchContacts();
    }, 30000); // refresh every 30s as fallback

    const handlePresence = () => {
      fetchContacts();
    };

    rtcManager.socket?.on("presence", handlePresence);
    rtcManager.socket?.on("contact_added", fetchContacts);
    rtcManager.socket?.on("mutual-connection", fetchContacts);
    window.addEventListener("refresh_contacts", fetchContacts);
    
    return () => {
      clearInterval(interval);
      rtcManager.socket?.off("presence", handlePresence);
      rtcManager.socket?.off("contact_added", fetchContacts);
      rtcManager.socket?.off("mutual-connection", fetchContacts);
      window.removeEventListener("refresh_contacts", fetchContacts);
    };
  }, []);

  useEffect(() => {
    const getContactName = async (from: string) => {
      const allContacts = await rtcManager.getContacts();
      const contactObj = allContacts.find(c => c.contactId === from);
      return contactObj?.alias || from;
    };

    const handleCallInvite = async (from: string, payload?: any) => {
      const callerName = await getContactName(from);
      const callId = payload?.callId || rtcManager.getActiveCallId(from) || '';
      setActiveCall({ contactId: from, callId, callerName, status: 'incoming' });
      setIsGlobalCallMinimized(false);
    };

    const handleCallAccept = async (from: string, payload?: any) => {
      const callerName = await getContactName(from);
      const callId = payload?.callId || rtcManager.getActiveCallId(from) || '';
      setActiveCall({ contactId: from, callId, callerName, status: 'ongoing' });
      setIsGlobalCallMinimized(false);
    };

    const handleCallConnected = (from: string) => {
      setActiveCall(prev => (prev?.contactId === from ? { ...prev, status: 'ongoing' } : prev));
    };

    const handleCallEnded = (from: string) => {
      setActiveCall(prev => (prev?.contactId === from ? null : prev));
    };

    const handleCallBusy = (from: string) => {
      setActiveCall(prev => (prev?.contactId === from ? null : prev));
    };

    const handleCallStatusUpdate = async (from: string, payload?: any) => {
      if (payload?.status === 'completed' || payload?.status === 'missed') {
        setActiveCall(prev => (prev?.contactId === from ? null : prev));
      } else if (payload?.status === 'ongoing') {
        const callerName = await getContactName(from);
        const callId = payload?.callId || rtcManager.getActiveCallId(from) || '';
        setActiveCall({ contactId: from, callId, callerName, status: 'ongoing' });
      }
    };

    const unsubInvite = rtcManager.onCallInvite(handleCallInvite);
    const unsubAccept = rtcManager.onCallAccept(handleCallAccept);
    const unsubConnected = rtcManager.onCallConnected(handleCallConnected);
    const unsubEnded = rtcManager.onCallEnded(handleCallEnded);
    const unsubBusy = rtcManager.onCallBusy(handleCallBusy);
    const unsubStatus = rtcManager.onCallStatusUpdate(handleCallStatusUpdate);

    return () => {
      unsubInvite();
      unsubAccept();
      unsubConnected();
      unsubEnded();
      unsubBusy();
      unsubStatus();
    };
  }, []);

  const handleAnswerCallFromBanner = async () => {
    if (!activeCall) return;
    const targetId = activeCall.contactId;
    const callId = activeCall.callId;

    let targetContact = contacts.find(c => c.contactId === targetId);
    if (!targetContact) {
      const all = await rtcManager.getContacts();
      targetContact = all.find(c => c.contactId === targetId);
    }
    if (!targetContact) {
      targetContact = {
        contactId: targetId,
        alias: activeCall.callerName,
        publicKey: '',
        mutual: true,
        online: true,
        addedAt: Date.now()
      };
    }

    setActiveContact(targetContact);
    setActiveTab('chats');
    setAutoAnswerCallId(callId);
    setActiveCall(prev => prev ? { ...prev, status: 'ongoing' } : null);
  };

  const handleDeclineCallFromBanner = async () => {
    if (!activeCall) return;
    const { contactId, callId } = activeCall;

    let callerId = contactId;
    if (callId) {
      const existing = await db.messages.get(callId);
      if (existing) callerId = existing.senderId;
    }

    rtcManager.saveOrUpdateCallMessage(contactId, callerId, callId, 'missed', 0);
    rtcManager.sendCallStatusUpdate(contactId, { callId, callerId, status: 'missed', duration: 0 });
    rtcManager.endVoiceCall(contactId, { callId, callerId, status: 'missed', duration: 0 });
    rtcManager.clearActiveCallId(contactId);
    setActiveCall(null);
  };

  const handleReturnToCallFromBanner = async () => {
    if (!activeCall) return;
    const targetId = activeCall.contactId;

    let targetContact = contacts.find(c => c.contactId === targetId);
    if (!targetContact) {
      const all = await rtcManager.getContacts();
      targetContact = all.find(c => c.contactId === targetId);
    }
    if (!targetContact) {
      targetContact = {
        contactId: targetId,
        alias: activeCall.callerName,
        publicKey: '',
        mutual: true,
        online: true,
        addedAt: Date.now()
      };
    }

    setActiveContact(targetContact);
    setActiveTab('chats');
  };

  const handleEndCallFromBanner = async () => {
    if (!activeCall) return;
    const { contactId, callId } = activeCall;

    const startTime = rtcManager.getCallStartTime(contactId);
    let finalDuration = 0;
    if (startTime) {
      finalDuration = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    }

    let callerId = userId || contactId;
    if (callId) {
      const existing = await db.messages.get(callId);
      if (existing) callerId = existing.senderId;
    }

    rtcManager.saveOrUpdateCallMessage(contactId, callerId, callId, 'completed', finalDuration);
    rtcManager.sendCallStatusUpdate(contactId, { callId, callerId, status: 'completed', duration: finalDuration });
    rtcManager.endVoiceCall(contactId, { callId, callerId, status: 'completed', duration: finalDuration });
    rtcManager.clearActiveCallId(contactId);
    setActiveCall(null);
  };

  const showGlobalBanner = !!activeCall && activeContact?.contactId !== activeCall.contactId;

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactId) return;
    const cleanId = newContactId.trim();
    const success = await rtcManager.addContact(cleanId, newContactAlias.trim() || 'Unknown');
    if (success) {
      setNewContactId('');
      setNewContactAlias('');
      setIsAdding(false);
      fetchContacts();
    } else {
      alert("Failed to add contact. Make sure the ID exists.");
    }
  };

  const confirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingId) {
      await rtcManager.removeContact(deletingId);
      if (activeContact?.contactId === deletingId) {
        setActiveContact(null);
      }
      setDeletingId(null);
      fetchContacts();
    }
  };

  const confirmEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (editingId && editingAliasValue.trim()) {
      await rtcManager.updateContactAlias(editingId, editingAliasValue.trim());
      fetchContacts();
      setEditingId(null);
      setEditingAliasValue('');
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col-reverse md:flex-row h-screen w-full bg-[#0F1115] text-slate-200 font-sans overflow-hidden relative">
      <audio ref={globalAudioRef} autoPlay playsInline />
      {/* Global Call UI (Full screen mobile view & top floating desktop/minimized banner) */}
      {showGlobalBanner && activeCall && (
        <>
          {/* Mobile Fullscreen Overlay (< md) */}
          {!isGlobalCallMinimized && (
            <div className="fixed inset-0 z-[100] bg-gradient-to-b from-[#0F141C] via-[#090C10] to-[#050709] flex flex-col justify-between p-6 sm:p-8 text-white md:hidden animate-in fade-in zoom-in-95 duration-200 select-none overflow-hidden">
              {/* Background ambient lighting effects */}
              <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

              {/* Header */}
              <div className="relative z-10 flex items-center justify-between pt-2">
                <button 
                  onClick={() => setIsGlobalCallMinimized(true)}
                  className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-90 text-slate-300 hover:text-white transition-all border border-white/10 backdrop-blur-md shadow-lg"
                  title="Minimize Call"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2 bg-emerald-500/10 px-3.5 py-1.5 rounded-full border border-emerald-500/25 backdrop-blur-md shadow-md">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] font-semibold tracking-wide text-emerald-300 uppercase">E2EE Voice</span>
                </div>

                <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
                  <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-bold text-slate-300">HD</span>
                </div>
              </div>

              {/* Center Info */}
              <div className="relative z-10 flex flex-col items-center justify-center text-center my-auto">
                <div className="relative mb-20 mt-2">
                  <div className="absolute -inset-6 rounded-full opacity-25 animate-ping bg-emerald-500" />
                  <div className="absolute -inset-10 rounded-full opacity-15 animate-pulse bg-emerald-400" />
                  <div className="relative w-36 h-36 rounded-full bg-slate-900 border-4 border-slate-700/80 flex items-center justify-center text-5xl font-black text-slate-100 shadow-2xl shadow-emerald-500/20 ring-4 ring-emerald-500/20">
                    {activeCall.callerName.charAt(0).toUpperCase()}
                  </div>
                </div>

                <h2 className="text-3xl font-black text-white tracking-tight mb-4 drop-shadow-md">
                  {activeCall.callerName}
                </h2>

                <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-5 py-2 rounded-full border border-slate-700/60 shadow-inner">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-sm font-semibold tracking-wide text-emerald-400">
                    {activeCall.status === 'incoming' 
                      ? 'Incoming Voice Call...' 
                      : 'Voice Call In Progress...'}
                  </p>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="relative z-10 pb-8 w-full max-w-sm mx-auto">
                {activeCall.status === 'incoming' ? (
                  <div className="flex items-center justify-around w-full px-4">
                    <button
                      onClick={handleDeclineCallFromBanner}
                      className="flex flex-col items-center gap-2.5 group active:scale-90 transition-transform"
                    >
                      <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500/60 text-red-400 group-hover:bg-red-500 group-hover:text-white flex items-center justify-center transition-all shadow-xl shadow-red-500/20">
                        <PhoneOff className="w-7 h-7" />
                      </div>
                      <span className="text-xs font-bold text-slate-300">Decline</span>
                    </button>

                    <button
                      onClick={handleAnswerCallFromBanner}
                      className="flex flex-col items-center gap-2.5 group active:scale-90 transition-transform"
                    >
                      <div className="w-16 h-16 rounded-full bg-emerald-500 text-slate-950 group-hover:bg-emerald-400 flex items-center justify-center transition-all shadow-2xl shadow-emerald-500/50 animate-bounce">
                        <Phone className="w-7 h-7 fill-current" />
                      </div>
                      <span className="text-xs font-bold text-emerald-400">Answer</span>
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-5 shadow-2xl flex items-center justify-around">
                    <button
                      onClick={handleReturnToCallFromBanner}
                      className="flex flex-col items-center gap-1.5 group active:scale-90 transition-transform"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all shadow-md">
                        <MessageSquare className="w-6 h-6 text-emerald-400" />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">Open Chat</span>
                    </button>

                    <button
                      onClick={handleEndCallFromBanner}
                      className="flex flex-col items-center gap-1.5 group active:scale-90 transition-transform"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-red-600 to-rose-500 text-white hover:from-red-500 hover:to-rose-400 flex items-center justify-center transition-all shadow-xl shadow-red-500/40">
                        <PhoneOff className="w-6 h-6" />
                      </div>
                      <span className="text-[11px] font-bold text-red-400">End</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop Banner & Minimized Mobile Floating Banner */}
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur-md border border-emerald-500/40 shadow-2xl rounded-2xl p-4 items-center justify-between gap-6 min-w-[340px] max-w-md text-white ring-1 ring-emerald-500/20 ${isGlobalCallMinimized ? 'flex' : 'hidden md:flex'}`}>
            <div 
              className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
              onClick={handleReturnToCallFromBanner}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                activeCall.status === 'incoming' 
                  ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' 
                  : 'bg-blue-500/20 text-blue-400 animate-pulse'
              }`}>
                <PhoneCall className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{activeCall.callerName}</p>
                <p className="text-xs text-emerald-400 font-medium">
                  {activeCall.status === 'incoming' 
                    ? 'Incoming voice call...' 
                    : 'Voice call in progress...'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isGlobalCallMinimized && (
                <button
                  onClick={() => setIsGlobalCallMinimized(false)}
                  className="p-2 text-slate-300 hover:text-white bg-slate-800 rounded-full transition-colors md:hidden"
                  title="Expand to full screen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}
              {activeCall.status === 'incoming' ? (
                <>
                  <button
                    onClick={handleAnswerCallFromBanner}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-full transition-colors flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    <Phone className="w-3.5 h-3.5 fill-current" />
                    Answer
                  </button>
                  <button
                    onClick={handleDeclineCallFromBanner}
                    className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-full transition-colors active:scale-95"
                    title="Decline"
                  >
                    <PhoneOff className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleReturnToCallFromBanner}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-full transition-colors"
                  >
                    Return
                  </button>
                  <button
                    onClick={handleEndCallFromBanner}
                    className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-full transition-colors active:scale-95"
                    title="End Call"
                  >
                    <PhoneOff className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Navigation Bar (Left on Desktop, Bottom on Mobile) */}
      <nav className="flex md:flex-col items-center justify-between md:justify-start bg-[#16191F] md:w-16 w-full h-16 md:h-full border-t md:border-t-0 md:border-r border-slate-800 z-30 shrink-0 md:py-4 px-2 md:px-0 gap-1 md:gap-0">
        <button onClick={() => { setActiveTab('chats'); setIsSidebarOpen(true); }} className={`flex-1 md:flex-none p-2 md:p-3 md:mb-4 rounded-xl transition-colors flex flex-col items-center justify-center gap-1 ${activeTab === 'chats' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
          <MessageSquare className="w-5 h-5 md:w-6 md:h-6" />
          <span className="text-[10px] md:hidden font-medium">Chats</span>
        </button>
        <button onClick={() => { setActiveTab('contacts'); setIsSidebarOpen(true); }} className={`flex-1 md:flex-none p-2 md:p-3 md:mb-4 rounded-xl transition-colors flex flex-col items-center justify-center gap-1 ${activeTab === 'contacts' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
          <Users className="w-5 h-5 md:w-6 md:h-6" />
          <span className="text-[10px] md:hidden font-medium">Contacts</span>
        </button>
        <button onClick={() => { setActiveTab('settings'); setIsSidebarOpen(true); }} className={`flex-1 md:flex-none p-2 md:p-3 md:mt-auto rounded-xl transition-colors flex flex-col items-center justify-center gap-1 ${activeTab === 'settings' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
          <Settings className="w-5 h-5 md:w-6 md:h-6" />
          <span className="text-[10px] md:hidden font-medium">Settings</span>
        </button>
      </nav>

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (activeTab !== 'chats' || !activeContact) && (
          <div 
            className="fixed inset-0 bg-black/50 z-10 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar: Lists based on active tab */}
        {activeTab !== 'settings' && (
        <aside className={`absolute md:relative z-20 w-full md:w-80 flex flex-col border-r border-slate-800 bg-[#16191F] h-full transition-transform duration-300 ${isSidebarOpen || activeTab === 'contacts' || (activeTab === 'chats' && !activeContact) ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="p-6 border-b border-slate-800 shrink-0">
            {activeTab === 'contacts' ? (
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-white">Contacts</h3>
                <button 
                  onClick={() => setIsAdding(!isAdding)}
                  className={`p-2 rounded-xl transition-colors flex items-center justify-center ${isAdding ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
                >
                  <UserPlus className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-white">Chats</h3>
              </div>
            )}
            
            {isAdding && activeTab === 'contacts' && (
              <form onSubmit={handleAddContact} className="mb-4 space-y-3 bg-[#0F1115] p-3 rounded-lg border border-slate-800">
                <input
                  type="text"
                  placeholder="Contact ID"
                  value={newContactId}
                  onChange={e => setNewContactId(e.target.value)}
                  className="w-full bg-[#16191F] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                />
                <input
                  type="text"
                  placeholder="Alias (Optional)"
                  value={newContactAlias}
                  onChange={e => setNewContactAlias(e.target.value)}
                  className="w-full bg-[#16191F] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 rounded text-xs font-semibold flex items-center justify-center gap-2 transition-colors">
                  <UserPlus className="w-4 h-4" /> Add
                </button>
              </form>
            )}
            <div className="relative">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={activeTab === 'chats' ? "Search chats or messages..." : "Search Contacts..."}
                className="w-full bg-[#0F1115] border border-slate-700 rounded-lg py-2 px-4 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {contacts.filter(contact => {
              if (!searchQuery.trim()) return true;
              const query = searchQuery.toLowerCase();
              if (contact.alias.toLowerCase().includes(query)) return true;
              if (activeTab === 'chats' && allTexts[contact.contactId]?.includes(query)) return true;
              return false;
            }).map(contact => {
              const isActive = activeContact?.contactId === contact.contactId;
              const handleContextMenu = (e: React.MouseEvent) => {
                e.preventDefault();
                setDeletingId(contact.contactId);
              };
              let touchTimeout: NodeJS.Timeout;
              const handleTouchStart = () => {
                touchTimeout = setTimeout(() => {
                  setDeletingId(contact.contactId);
                }, 500);
              };
              const handleTouchEnd = () => {
                if (touchTimeout) clearTimeout(touchTimeout);
              };

              const handleClick = () => {
                setActiveContact(contact);
                setIsSidebarOpen(false);
                if (activeTab === 'contacts') {
                  setActiveTab('chats');
                }
              };

              return (
                <div 
                  key={contact.contactId}
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  className={`p-3 flex items-center cursor-pointer rounded-xl transition-colors group select-none ${
                    isActive && activeTab === 'chats' ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-slate-800 opacity-70 border border-transparent'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-700 mr-3 flex-shrink-0 flex items-center justify-center text-lg font-medium text-slate-300 relative">
                    {contact.alias.charAt(0).toUpperCase()}
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#16191F] ${contact.online ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      {editingId === contact.contactId ? (
                        <form onSubmit={confirmEdit} className="flex items-center w-full gap-2 pr-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingAliasValue}
                            onChange={(e) => setEditingAliasValue(e.target.value)}
                            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-white outline-none focus:border-emerald-500"
                            autoFocus
                          />
                          <button type="submit" className="text-[10px] text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 px-2 py-1 rounded transition-colors font-bold flex-shrink-0">Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="text-[10px] text-slate-400 hover:text-white px-2 py-1 transition-colors flex-shrink-0">Cancel</button>
                        </form>
                      ) : (
                        <>
                          <span className={`text-sm font-semibold truncate ${isActive && activeTab === 'chats' ? 'text-white' : ''}`}>{contact.alias}</span>
                          {deletingId === contact.contactId && (
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); setEditingId(contact.contactId); setEditingAliasValue(contact.alias); }} className="text-[10px] text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 px-2 py-1 rounded transition-colors font-bold">Edit</button>
                              <button onClick={confirmDelete} className="text-[10px] text-red-400 bg-red-400/10 hover:bg-red-400/20 px-2 py-1 rounded transition-colors font-bold">Remove</button>
                              <button onClick={(e) => { e.stopPropagation(); setDeletingId(null); }} className="text-[10px] text-slate-400 hover:text-white px-2 py-1 transition-colors">Cancel</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {activeTab === 'chats' ? (
                      <div className="flex justify-between items-center mt-1">
                        <p className={`text-xs truncate pr-2 ${isActive ? 'text-slate-400' : (unreadCounts[contact.contactId] > 0 ? 'text-emerald-500' : 'text-slate-500')}`}>
                          {(() => {
                            const lastMsgData = lastMessages[contact.contactId];
                            const lastMsg = lastMsgData?.message;
                            if (lastMsg) {
                              if (lastMsg.type === 'text') return lastMsgData.plainText || 'Text message';
                              if (lastMsg.type === 'image') return '📷 Image';
                              if (lastMsg.type === 'audio') return '🎤 Voice message';
                              if (lastMsg.type === 'video') return '🎥 Video';
                              if (lastMsg.type === 'file') return '📄 File';
                              if (lastMsg.type === 'call') {
                                const isCaller = lastMsg.senderId === userId;
                                return (
                                  <span className="inline-flex items-center gap-1">
                                    {isCaller ? (
                                      <PhoneOutgoing className="w-3.5 h-3.5 inline text-slate-400" />
                                    ) : (
                                      <PhoneIncoming className="w-3.5 h-3.5 inline text-slate-400" />
                                    )}
                                    <span>Call</span>
                                  </span>
                                );
                              }
                            }
                            return '';
                          })()}
                        </p>
                        {unreadCounts[contact.contactId] > 0 && !isActive ? (
                          <span className="bg-emerald-500 text-[#0F1115] text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shrink-0">
                            {unreadCounts[contact.contactId]}
                          </span>
                        ) : lastMessages[contact.contactId]?.message ? (
                          <span className="text-[10px] text-slate-500 font-medium shrink-0">
                            {new Date(lastMessages[contact.contactId].message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex justify-between items-center mt-1">
                        <p className={`text-xs truncate pr-2 text-slate-500`}>
                          {!contact.mutual ? "Awaiting mutual" : contact.online ? "Active" : "Offline"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {contacts.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-xs">
                No contacts yet.
              </div>
            )}
          </nav>
        </aside>
        )}

        {/* Settings View */}
        {activeTab === 'settings' && (
          <aside className={`absolute md:relative z-20 w-full md:w-80 flex flex-col border-r border-slate-800 bg-[#16191F] h-full transition-transform duration-300 ${isSidebarOpen || activeTab === 'settings' ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <div className="p-6 border-b border-slate-800 shrink-0">
              <h3 className="font-bold text-lg text-white text-center">Settings</h3>
            </div>
            <div className="p-6 flex flex-col gap-6 overflow-y-auto">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center border-2 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                  <Shield className="w-10 h-10 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-white font-bold text-lg">Encrypted Session</h4>
                  <p className="text-xs text-emerald-400 font-medium mt-1">End-to-End Encrypted</p>
                </div>
              </div>

              <div className="bg-[#0F1115] border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your Contact ID</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#16191F] text-slate-300 text-xs py-2 px-3 rounded-lg border border-slate-800 break-all select-all font-mono">
                    {userId}
                  </code>
                  <button 
                    onClick={() => navigator.clipboard.writeText(userId || '')}
                    className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors shrink-0"
                    title="Copy ID"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-auto pt-6 border-t border-slate-800">
                <button 
                  onClick={logout} 
                  className="flex items-center justify-center gap-2 text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 transition-colors p-3 rounded-xl text-sm font-bold w-full"
                >
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 flex flex-col relative bg-[#0F1115] hidden md:flex">
          {activeContact && activeTab === 'chats' ? (
            <ChatView 
              contact={activeContact} 
              onOpenMenu={() => { /* Not needed on desktop */ }} 
              autoAnswerCallId={autoAnswerCallId}
              onAutoAnswerHandled={() => setAutoAnswerCallId(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center flex-col text-slate-600 relative">
              <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4 mt-16"> 
                <Shield className="w-8 h-8 opacity-50" />
              </div>
              <p className="text-sm font-semibold">Select a contact to start an encrypted session</p>
            </div>
          )}
        </main>
        
        {/* Mobile Main Content Area overlay */}
        <main className={`flex-1 min-w-0 flex flex-col relative bg-[#0F1115] md:hidden ${activeTab === 'chats' && activeContact ? 'absolute inset-0 z-40' : 'hidden'}`}>
          {activeContact && activeTab === 'chats' && (
            <ChatView 
              contact={activeContact} 
              onOpenMenu={() => { setActiveContact(null); }} 
              autoAnswerCallId={autoAnswerCallId}
              onAutoAnswerHandled={() => setAutoAnswerCallId(null)}
            />
          )}
        </main>

      </div>
    </div>
  );
}
