import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, LocalMessage, LocalFile } from '../db';
import { useUser } from '../context';
import { rtcManager } from '../webrtc';
import { Contact } from '../types';
import { decryptText, decryptFile } from '../crypto';
import { Send, Paperclip, Mic, Clock, Trash2, X, Download, Menu, ArrowLeft, Check, CheckCheck, Play, Square, Phone, PhoneCall, PhoneOff, MicOff, Camera, Video, Smile, Reply, Copy, Plus, ChevronDown, PhoneOutgoing, PhoneIncoming, Maximize2, Shield, Volume2, VolumeX, Radio } from 'lucide-react';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';

export default function ChatView({ 
  contact, 
  onOpenMenu, 
  autoAnswerCallId, 
  onAutoAnswerHandled 
}: { 
  contact: Contact; 
  onOpenMenu?: () => void; 
  autoAnswerCallId?: string | null; 
  onAutoAnswerHandled?: () => void; 
}) {
  const { userId, aesKey } = useUser();
  const [inputText, setInputText] = useState('');
  const [isRemoteTyping, setIsRemoteTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<(LocalMessage & { plainContent: string, meta?: any }) | null>(null);
  const [filePreview, setFilePreview] = useState<{file: File, buffer: ArrayBuffer, type: 'image' | 'video' | 'audio' | 'file', url: string} | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const unsub = rtcManager.onTyping((contactId, isTyping) => {
      if (contactId === contact.contactId) {
        setIsRemoteTyping(isTyping);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (isTyping) {
          typingTimeoutRef.current = setTimeout(() => setIsRemoteTyping(false), 3000);
        }
      }
    });
    return () => unsub();
  }, [contact.contactId]);
  
  const [expiresIn, setExpiresIn] = useState<number>(() => {
    const saved = localStorage.getItem(`ephemeral_${userId}_${contact.contactId}`);
    return saved ? parseInt(saved, 10) : 0;
  });

  const [isInCall, setIsInCall] = useState(false);
  const [isReceivingCall, setIsReceivingCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isCallConnected, setIsCallConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callBusyNotice, setCallBusyNotice] = useState<string | null>(null);
  const [activeCallContactName, setActiveCallContactName] = useState<string | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentCallIdRef = useRef<string | null>(null);
  const activeCallContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    rtcManager.setIsBusy(isInCall || isReceivingCall || isCalling);
  }, [isInCall, isReceivingCall, isCalling]);

  useEffect(() => {
    const checkActiveCall = async () => {
      const activeCallId = rtcManager.getActiveCallId(contact.contactId);
      const hasStream = rtcManager.callStreams.has(contact.contactId);
      const hasPeer = rtcManager.callPeers.has(contact.contactId);

      if (activeCallId || hasStream || hasPeer) {
        activeCallContactIdRef.current = contact.contactId;
        setActiveCallContactName(contact.alias || contact.contactId);
        if (activeCallId) currentCallIdRef.current = activeCallId;

        const startTime = rtcManager.getCallStartTime(contact.contactId);

        if (hasStream || hasPeer || startTime) {
          setIsInCall(true);
          setIsCallConnected(true);
          setIsCalling(false);
          setIsReceivingCall(false);

          let st = startTime;
          if (!st) {
            st = Date.now();
            rtcManager.setCallStartTime(contact.contactId, st);
          }

          const elapsed = Math.max(0, Math.floor((Date.now() - st) / 1000));
          setCallDuration(elapsed);

          if (callTimerRef.current) clearInterval(callTimerRef.current);
          callTimerRef.current = setInterval(() => {
            const curStart = rtcManager.getCallStartTime(contact.contactId);
            if (curStart) {
              setCallDuration(Math.max(0, Math.floor((Date.now() - curStart) / 1000)));
            } else {
              setCallDuration(p => p + 1);
            }
          }, 1000);

          return;
        }

        if (activeCallId) {
          const msg = await db.messages.get(activeCallId);
          if (msg && msg.type === 'call' && msg.content) {
            try {
              const meta = JSON.parse(msg.content);
              if (meta) {
                if (meta.status === 'ongoing') {
                  setIsInCall(true);
                  setIsCallConnected(true);
                  setIsCalling(false);
                  setIsReceivingCall(false);

                  let st = rtcManager.getCallStartTime(contact.contactId);
                  if (!st) {
                    st = msg.timestamp || Date.now();
                    rtcManager.setCallStartTime(contact.contactId, st);
                  }
                  const elapsed = Math.max(0, Math.floor((Date.now() - st) / 1000));
                  setCallDuration(elapsed);

                  if (callTimerRef.current) clearInterval(callTimerRef.current);
                  callTimerRef.current = setInterval(() => {
                    const curStart = rtcManager.getCallStartTime(contact.contactId);
                    if (curStart) {
                      setCallDuration(Math.max(0, Math.floor((Date.now() - curStart) / 1000)));
                    } else {
                      setCallDuration(p => p + 1);
                    }
                  }, 1000);
                } else if (meta.status === 'calling') {
                  if (meta.callerId === userId) {
                    setIsCalling(true);
                    setIsInCall(false);
                    setIsReceivingCall(false);
                  } else {
                    setIsReceivingCall(true);
                    setIsInCall(false);
                    setIsCalling(false);
                  }
                } else {
                  setIsInCall(false);
                  setIsCalling(false);
                  setIsReceivingCall(false);
                  setIsCallConnected(false);
                }
              }
            } catch (e) {}
          }
        }
      } else {
        setIsInCall(false);
        setIsCalling(false);
        setIsReceivingCall(false);
        setIsCallConnected(false);
      }
    };

    checkActiveCall();
  }, [contact.contactId, userId]);

  useEffect(() => {
    if ((isInCall || isReceivingCall || isCallConnected) && remoteAudioRef.current) {
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      const stream = rtcManager.callStreams.get(activeContactId);
      if (stream && remoteAudioRef.current.srcObject !== stream) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(e => console.warn("Audio play notice:", e?.message || e));
      }
    }
  }, [isInCall, isReceivingCall, isCallConnected, contact.contactId]);

  useEffect(() => {
    if (autoAnswerCallId) {
      answerCall();
      if (onAutoAnswerHandled) {
        onAutoAnswerHandled();
      }
    }
  }, [autoAnswerCallId]);

  useEffect(() => {
    const handleCall = (contactId: string, stream: MediaStream) => {
      console.log("Received remote stream for", contactId, stream, stream.getTracks());
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      if (contactId === activeContactId) {
        if (remoteAudioRef.current) {
          console.log("Setting remoteAudioRef srcObject");
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().then(() => {
            console.log("Audio playing successfully");
          }).catch(e => console.warn("Audio play notice:", e?.message || e));
        } else {
          console.warn("remoteAudioRef.current is null!");
        }
      }
    };
    
    const handleCallEnded = (contactId: string) => {
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      if (contactId === activeContactId) {
        const callId = currentCallIdRef.current || rtcManager.getActiveCallId(activeContactId);
        const startTime = rtcManager.getCallStartTime(activeContactId);
        let finalDuration = callDuration;
        if (startTime) {
          finalDuration = Math.max(finalDuration, Math.floor((Date.now() - startTime) / 1000));
        }

        const wasConnected = isCallConnected || finalDuration > 0 || !!startTime || isInCall;
        const finalStatus = wasConnected ? 'completed' : 'missed';

        if (callId) {
          db.messages.get(callId).then(existing => {
            const callerId = existing ? existing.senderId : activeContactId;
            rtcManager.saveOrUpdateCallMessage(activeContactId, callerId, callId, finalStatus, finalDuration);
            rtcManager.clearActiveCallId(activeContactId);
          });
        }

        setIsInCall(false);
        setIsReceivingCall(false);
        setIsCalling(false);
        setIsCallConnected(false);
        setIsMuted(false);
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        setCallDuration(0);
        currentCallIdRef.current = null;
        activeCallContactIdRef.current = null;
        setActiveCallContactName(null);
        
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
      }
    };

    const handleCallInvite = async (contactId: string, payload?: any) => {
      if (!isInCall && !isCalling) {
        activeCallContactIdRef.current = contactId;
        const allContacts = await rtcManager.getContacts();
        const found = allContacts.find(c => c.contactId === contactId);
        setActiveCallContactName(found?.alias || contactId);

        setIsReceivingCall(true);
        if (payload?.callId) {
          currentCallIdRef.current = payload.callId;
          rtcManager.setActiveCallId(contactId, payload.callId);
        }
      }
    };

    const handleCallAccept = (contactId: string, payload?: any) => {
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      if (contactId === activeContactId && isCalling) {
        setIsInCall(true);
        setIsCalling(false);
        const callId = payload?.callId || currentCallIdRef.current || rtcManager.getActiveCallId(activeContactId);
        if (callId) {
          currentCallIdRef.current = callId;
          rtcManager.setActiveCallId(activeContactId, callId);
        }
        if (localStreamRef.current) {
          rtcManager.startVoiceCall(activeContactId, localStreamRef.current);
        }
      }
    };

    const handleCallConnectedEvent = (contactId: string) => {
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      if (contactId === activeContactId) {
        setIsCallConnected(true);
        let st = rtcManager.getCallStartTime(activeContactId);
        if (!st) {
          st = Date.now();
          rtcManager.setCallStartTime(activeContactId, st);
        }
        const elapsed = Math.max(0, Math.floor((Date.now() - st) / 1000));
        setCallDuration(elapsed);

        if (callTimerRef.current) clearInterval(callTimerRef.current);
        callTimerRef.current = setInterval(() => {
          const curStart = rtcManager.getCallStartTime(activeContactId);
          if (curStart) {
            setCallDuration(Math.max(0, Math.floor((Date.now() - curStart) / 1000)));
          } else {
            setCallDuration(p => p + 1);
          }
        }, 1000);
        
        const callId = currentCallIdRef.current || rtcManager.getActiveCallId(activeContactId);
        if (callId) {
          db.messages.get(callId).then(existing => {
            const callerId = existing ? existing.senderId : (userId || '');
            rtcManager.saveOrUpdateCallMessage(activeContactId, callerId, callId, 'ongoing', 0);
          });
        }

        if (remoteAudioRef.current && remoteAudioRef.current.srcObject) {
          remoteAudioRef.current.play().catch(e => console.warn("Play on connect notice:", e?.message || e));
        }
      }
    };

    const handleCallBusy = (contactId: string, payload?: any) => {
      const activeContactId = activeCallContactIdRef.current || contact.contactId;
      if (contactId === activeContactId && (isCalling || activeCallContactIdRef.current === contactId)) {
        setIsCalling(false);
        setCallBusyNotice('User is in another call');
        activeCallContactIdRef.current = contactId;

        setTimeout(() => {
          setCallBusyNotice(null);
          if (activeCallContactIdRef.current === contactId) {
            activeCallContactIdRef.current = null;
            setActiveCallContactName(null);
          }
        }, 4000);

        const callId = payload?.callId || currentCallIdRef.current || rtcManager.getActiveCallId(activeContactId);
        if (callId) {
          db.messages.get(callId).then(existing => {
            const callerId = existing ? existing.senderId : (userId || '');
            rtcManager.saveOrUpdateCallMessage(activeContactId, callerId, callId, 'missed', 0);
            rtcManager.clearActiveCallId(activeContactId);
          });
        }

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }
        currentCallIdRef.current = null;
      }
    };

    const unsubCall = rtcManager.onCall(handleCall);
    const unsubCallEnded = rtcManager.onCallEnded(handleCallEnded);
    const unsubCallInvite = rtcManager.onCallInvite(handleCallInvite);
    const unsubCallAccept = rtcManager.onCallAccept(handleCallAccept);
    const unsubCallConnected = rtcManager.onCallConnected(handleCallConnectedEvent);
    const unsubCallBusy = rtcManager.onCallBusy(handleCallBusy);
    
    return () => {
      unsubCall();
      unsubCallEnded();
      unsubCallInvite();
      unsubCallAccept();
      unsubCallConnected();
      unsubCallBusy();
    };
  }, [contact.contactId, isCalling, isInCall, isCallConnected, callDuration, userId]);

  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, []);

  const startCall = async () => {
    if (!contact.online || !contact.mutual) {
      console.warn("Cannot call: contact is offline or not mutual");
      return;
    }
    if (isInCall || isReceivingCall || isCalling) return;

    try {
      const callContactId = contact.contactId;
      activeCallContactIdRef.current = callContactId;
      setActiveCallContactName(contact.alias || contact.contactId);

      console.log("Requesting mic for startCall...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log("Got mic stream", stream.getTracks());
      localStreamRef.current = stream;
      setIsCalling(true);
      setIsCallMinimized(false);

      const newCallId = crypto.randomUUID ? crypto.randomUUID() : `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      currentCallIdRef.current = newCallId;
      rtcManager.setActiveCallId(callContactId, newCallId);

      await rtcManager.saveOrUpdateCallMessage(callContactId, userId!, newCallId, 'calling', 0);
      rtcManager.sendCallInvite(callContactId, { callId: newCallId, callerId: userId });
    } catch (e) {
      console.error("Failed to start call", e);
      alert("Microphone permission denied.");
    }
  };

  const answerCall = async () => {
    try {
      const callContactId = activeCallContactIdRef.current || contact.contactId;
      activeCallContactIdRef.current = callContactId;

      console.log("Requesting mic for answerCall...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log("Got mic stream", stream.getTracks());
      localStreamRef.current = stream;
      setIsInCall(true);
      setIsReceivingCall(false);
      
      const callId = currentCallIdRef.current || rtcManager.getActiveCallId(callContactId) || (crypto.randomUUID ? crypto.randomUUID() : `call_${Date.now()}`);
      currentCallIdRef.current = callId;
      rtcManager.setActiveCallId(callContactId, callId);
      rtcManager.setCallStartTime(callContactId);

      await rtcManager.saveOrUpdateCallMessage(callContactId, callContactId, callId, 'ongoing', 0);
      rtcManager.acceptVoiceCall(callContactId, stream);
      rtcManager.sendCallAccept(callContactId, { callId, callerId: callContactId });
      rtcManager.sendCallStatusUpdate(callContactId, { callId, callerId: callContactId, status: 'ongoing', duration: 0 });
      
      const remoteStream = rtcManager.callStreams.get(callContactId);
      if (remoteStream && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play().catch(e => console.warn("Audio play notice:", e?.message || e));
      }
    } catch (e) {
      console.error("Failed to answer call", e);
      endCall();
    }
  };

  const endCall = () => {
    const callContactId = activeCallContactIdRef.current || contact.contactId;
    const callId = currentCallIdRef.current || rtcManager.getActiveCallId(callContactId);
    
    const startTime = rtcManager.getCallStartTime(callContactId);
    let finalDuration = callDuration;
    if (startTime) {
      finalDuration = Math.max(finalDuration, Math.floor((Date.now() - startTime) / 1000));
    }

    const wasConnected = isCallConnected || finalDuration > 0 || !!startTime || isInCall;
    const finalStatus = wasConnected ? 'completed' : 'missed';

    if (callId) {
      db.messages.get(callId).then(existing => {
        const callerId = existing ? existing.senderId : (userId || '');
        rtcManager.saveOrUpdateCallMessage(callContactId, callerId, callId, finalStatus, finalDuration);
        rtcManager.sendCallStatusUpdate(callContactId, { callId, callerId, status: finalStatus, duration: finalDuration });
        rtcManager.endVoiceCall(callContactId, { callId, callerId, status: finalStatus, duration: finalDuration });
        rtcManager.clearActiveCallId(callContactId);
      });
    } else {
      rtcManager.endVoiceCall(callContactId, { callId: '', callerId: userId || '', status: finalStatus, duration: finalDuration });
    }

    setIsInCall(false);
    setIsReceivingCall(false);
    setIsCalling(false);
    setIsCallConnected(false);
    setIsMuted(false);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setCallDuration(0);
    currentCallIdRef.current = null;
    activeCallContactIdRef.current = null;
    setActiveCallContactName(null);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      let muted = isMuted;
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
        muted = !track.enabled;
      });
      setIsMuted(muted);
    }
  };

  const toggleSpeaker = () => {
    if (remoteAudioRef.current) {
      const nextSpeakerState = !isSpeakerOn;
      remoteAudioRef.current.volume = nextSpeakerState ? 1.0 : 0.2;
      setIsSpeakerOn(nextSpeakerState);
    } else {
      setIsSpeakerOn(!isSpeakerOn);
    }
  };

  const formatCallDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    localStorage.setItem(`ephemeral_${userId}_${contact.contactId}`, expiresIn.toString());
  }, [expiresIn, userId, contact.contactId]);

  const [decryptedMessages, setDecryptedMessages] = useState<(LocalMessage & { plainContent: string, plainFile?: ArrayBuffer })[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      setContextMenuMsgId(null);
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const rawMessages = useLiveQuery(
    () => db.messages.where('chatId').equals(contact.contactId).sortBy('timestamp'),
    [contact.contactId]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    
    // Mark received messages as read
    const markAsRead = async () => {
      if (!rawMessages) return;
      let updated = false;
      for (const m of rawMessages) {
        if (m.senderId === contact.contactId && m.status !== 'read') {
          await db.messages.update(m.id, { status: 'read' });
          rtcManager.sendAck(contact.contactId, m.id, 'read');
          updated = true;
        }
      }
    };
    markAsRead();
  }, [decryptedMessages, contact.contactId, rawMessages]);

  useEffect(() => {
    if (!rawMessages || !aesKey) return;
    
    let isMounted = true;
    
    const decryptAll = async () => {
      const dec = await Promise.all(rawMessages.map(async (m) => {
        const plainContent = await decryptText(m.content, aesKey);
        let plainFile: ArrayBuffer | undefined;
        
        if (m.fileId) {
          const fileRecord = await db.files.get(m.fileId);
          if (fileRecord) {
            plainFile = await decryptFile(fileRecord.data, aesKey);
          }
        }
        
        return { ...m, plainContent, plainFile };
      }));
      
      if (isMounted) {
        setDecryptedMessages(dec);
      }
    };
    
    decryptAll();
    
    return () => { isMounted = false; };
  }, [rawMessages, aesKey]);

  // Calculate chat expiration globally
  const oldestMessage = rawMessages && rawMessages.length > 0 ? rawMessages[0] : null;
  const chatExpiresAt = oldestMessage && expiresIn > 0 ? oldestMessage.timestamp + expiresIn * 60000 : null;

  // We rely on MainLayout.tsx for the global interval deletion to ensure it happens 
  // even if this component isn't mounted, but we can also have a force refresh for the UI here
  const [, setTick] = useState(0);
  useEffect(() => {
    if (chatExpiresAt) {
      const interval = setInterval(() => setTick(t => t + 1), 10000); // 10s tick for UI
      return () => clearInterval(interval);
    }
  }, [chatExpiresAt]);

  const lastTypingTime = useRef<number>(0);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    
    if (contact.mutual && contact.online) {
      const now = Date.now();
      if (now - lastTypingTime.current > 1000) {
         rtcManager.sendTyping(contact.contactId, true);
         lastTypingTime.current = now;
      }
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    await rtcManager.connectToContact(contact.contactId);
    await rtcManager.sendMessage(contact.contactId, inputText, expiresIn > 0 ? expiresIn * 60000 : undefined, replyingTo?.id);
    setInputText('');
    setReplyingTo(null);
    rtcManager.sendTyping(contact.contactId, false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const buffer = await file.arrayBuffer();
    const type = file.type.startsWith('image/') ? 'image' : 
                 file.type.startsWith('audio/') ? 'audio' : 
                 file.type.startsWith('video/') ? 'video' : 'file';
                 
    if (type === 'image' || type === 'video') {
      setFilePreview({
        file,
        buffer,
        type,
        url: URL.createObjectURL(file)
      });
      e.target.value = '';
      return;
    }

    await rtcManager.connectToContact(contact.contactId);
    await rtcManager.sendFile(contact.contactId, buffer, type, { name: file.name, type: file.type }, expiresIn > 0 ? expiresIn * 60000 : undefined, replyingTo?.id);
    setReplyingTo(null);
    e.target.value = '';
  };

  const sendFilePreview = async () => {
    if (!filePreview) return;
    await rtcManager.connectToContact(contact.contactId);
    await rtcManager.sendFile(contact.contactId, filePreview.buffer, filePreview.type, { name: filePreview.file.name, type: filePreview.file.type }, expiresIn > 0 ? expiresIn * 60000 : undefined, replyingTo?.id);
    URL.revokeObjectURL(filePreview.url);
    setFilePreview(null);
    setReplyingTo(null);
  };

  const cancelFilePreview = () => {
    if (filePreview) {
      URL.revokeObjectURL(filePreview.url);
      setFilePreview(null);
    }
  };

  const handleDeleteAll = async () => {
    const msgs = await db.messages.where('chatId').equals(contact.contactId).toArray();
    for (const m of msgs) {
      if (m.fileId) await db.files.delete(m.fileId);
      await db.messages.delete(m.id);
    }
  };

  const downloadFile = (buffer: ArrayBuffer, name: string, mime: string) => {
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full relative bg-[#0F1115] min-w-0">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-slate-800 bg-[#0F1115]">
        <div className="flex items-center gap-4">
          <button 
            onClick={onOpenMenu}
            className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-lg font-medium text-slate-300">
              {contact.alias.charAt(0).toUpperCase()}
            </div>
            <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-[#0F1115] rounded-full ${contact.online ? 'bg-emerald-500' : 'bg-slate-500'}`} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">{contact.alias}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-slate-400">ID: {contact.contactId}</span>
              {!contact.mutual ? (
                <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[8px] border border-slate-700">AWAITING MUTUAL</span>
              ) : contact.online ? (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[8px] border border-emerald-500/20">ACTIVE</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[8px] border border-slate-700">OFFLINE</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact.mutual && contact.online && !isInCall && !isReceivingCall && !isCalling && (
            <button onClick={startCall} className="p-2 text-emerald-400 bg-emerald-500/10 rounded-full hover:bg-emerald-500/20 transition-colors" title="Voice Call">
              <Phone className="w-4 h-4" />
            </button>
          )}
          <button 
            onClick={handleDeleteAll} 
            className="p-2 bg-red-500/10 text-red-500 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors flex items-center justify-center"
            title="Clear All Messages"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>
      
      <audio ref={remoteAudioRef} autoPlay playsInline muted={false} />

      {/* Call UI (Full screen mobile view & top desktop banner) */}
      {(isInCall || isReceivingCall || isCalling || !!callBusyNotice) && (activeCallContactIdRef.current === contact.contactId || !!callBusyNotice) && (
        <>
          {/* Fullscreen Mobile View (< md) */}
          {!isCallMinimized && (
            <div className="fixed inset-0 z-[100] bg-gradient-to-b from-[#0F141C] via-[#090C10] to-[#050709] flex flex-col justify-between p-6 sm:p-8 text-white md:hidden animate-in fade-in zoom-in-95 duration-200 select-none overflow-hidden">
              {/* Background ambient lighting effects */}
              <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

              {/* Top Bar: Minimize, Encryption & HD Signal */}
              <div className="relative z-10 flex items-center justify-between pt-2">
                <button 
                  onClick={() => setIsCallMinimized(true)}
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

              {/* Center: Avatar, Contact Alias & Live Timer / Status */}
              <div className="relative z-10 flex flex-col items-center justify-center text-center my-auto">
                <div className="relative mb-20 mt-2">
                  {(isCalling || isReceivingCall || isCallConnected) && (
                    <>
                      <div className="absolute -inset-6 rounded-full opacity-25 animate-ping bg-emerald-500" />
                      <div className="absolute -inset-10 rounded-full opacity-15 animate-pulse bg-emerald-400" />
                    </>
                  )}
                  <div className="relative w-36 h-36 rounded-full bg-slate-900 border-4 border-slate-700/80 flex items-center justify-center text-5xl font-black text-slate-100 shadow-2xl shadow-emerald-500/20 ring-4 ring-emerald-500/20">
                    {(activeCallContactName || contact.alias).charAt(0).toUpperCase()}
                  </div>
                </div>

                <h2 className="text-3xl font-black text-white tracking-tight mb-4 drop-shadow-md">
                  {activeCallContactName || contact.alias}
                </h2>

                <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-5 py-2 rounded-full border border-slate-700/60 shadow-inner">
                  {isCallConnected && (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  <p className="text-sm font-semibold tracking-wide text-emerald-400">
                    {callBusyNotice 
                      ? 'User Busy' 
                      : isReceivingCall 
                        ? 'Incoming Voice Call...' 
                        : isCallConnected 
                          ? formatCallDuration(callDuration) 
                          : isCalling 
                            ? 'Calling Contact...' 
                            : 'Connecting Stream...'
                    }
                  </p>
                </div>

                {callBusyNotice && (
                  <p className="text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full mt-4">{callBusyNotice}</p>
                )}
              </div>

              {/* Bottom Controls Panel */}
              <div className="relative z-10 pb-8 w-full max-w-sm mx-auto">
                {!callBusyNotice && isReceivingCall ? (
                  <div className="flex items-center justify-around w-full px-4">
                    <button
                      onClick={() => {
                        setCallBusyNotice(null);
                        endCall();
                      }}
                      className="flex flex-col items-center gap-2.5 group active:scale-90 transition-transform"
                    >
                      <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500/60 text-red-400 group-hover:bg-red-500 group-hover:text-white flex items-center justify-center transition-all shadow-xl shadow-red-500/20">
                        <PhoneOff className="w-7 h-7" />
                      </div>
                      <span className="text-xs font-bold text-slate-300">Decline</span>
                    </button>

                    <button
                      onClick={answerCall}
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
                    {!callBusyNotice && (
                      <>
                        {/* Mute Button */}
                        <button
                          onClick={toggleMute}
                          className="flex flex-col items-center gap-1.5 group active:scale-90 transition-transform"
                        >
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-md ${
                            isMuted 
                              ? 'bg-amber-500/20 border border-amber-500/50 text-amber-400' 
                              : 'bg-white/10 border border-white/10 text-white hover:bg-white/20'
                          }`}>
                            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                          </div>
                          <span className="text-[11px] font-semibold text-slate-400">{isMuted ? 'Muted' : 'Mute'}</span>
                        </button>

                        {/* Speaker Button */}
                        <button
                          onClick={toggleSpeaker}
                          className="flex flex-col items-center gap-1.5 group active:scale-90 transition-transform"
                        >
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-md ${
                            !isSpeakerOn 
                              ? 'bg-slate-800 border border-slate-700 text-slate-500' 
                              : 'bg-white/10 border border-white/10 text-white hover:bg-white/20'
                          }`}>
                            {!isSpeakerOn ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6 text-emerald-400" />}
                          </div>
                          <span className="text-[11px] font-semibold text-slate-400">{isSpeakerOn ? 'Speaker' : 'Off'}</span>
                        </button>

                        {/* Chat View Button */}
                        <button
                          onClick={() => setIsCallMinimized(true)}
                          className="flex flex-col items-center gap-1.5 group active:scale-90 transition-transform"
                        >
                          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all shadow-md">
                            <Maximize2 className="w-5 h-5" />
                          </div>
                          <span className="text-[11px] font-semibold text-slate-400">Chat</span>
                        </button>
                      </>
                    )}

                    {/* End Call Button */}
                    <button
                      onClick={() => {
                        setCallBusyNotice(null);
                        endCall();
                      }}
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

          {/* Desktop Banner & Minimized Mobile Banner */}
          <div className={`bg-slate-800 border-b border-slate-700 px-6 py-3 items-center justify-between ${isCallMinimized ? 'flex' : 'hidden md:flex'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${callBusyNotice ? 'bg-amber-500/20 text-amber-400' : isReceivingCall ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' : 'bg-blue-500/20 text-blue-400 animate-pulse'}`}>
                {callBusyNotice ? <PhoneOff className="w-4 h-4" /> : isReceivingCall ? <PhoneCall className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  {callBusyNotice 
                    ? 'User Busy' 
                    : isReceivingCall 
                      ? 'Incoming voice call...' 
                      : 'Voice Call'
                  }
                </p>
                <p className="text-xs text-slate-400">
                  {callBusyNotice 
                    ? callBusyNotice 
                    : isCallConnected 
                      ? formatCallDuration(callDuration) 
                      : isCalling 
                        ? 'Calling...' 
                        : 'Connecting...'
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isCallMinimized && (
                <button
                  onClick={() => setIsCallMinimized(false)}
                  className="p-2 text-slate-300 hover:text-white bg-slate-700 rounded-full transition-colors md:hidden"
                  title="Expand to full screen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}
              {!callBusyNotice && isReceivingCall && (
                <button onClick={answerCall} className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-full transition-colors">
                  Answer
                </button>
              )}
              {!callBusyNotice && !isReceivingCall && (
                <button 
                  onClick={toggleMute} 
                  className={`p-2 rounded-full transition-colors ${isMuted ? 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button 
                onClick={() => {
                  setCallBusyNotice(null);
                  endCall();
                }} 
                className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex justify-center">
          <span className="text-[10px] bg-slate-800/50 text-slate-500 px-3 py-1 rounded-full">Encrypted content stored in IndexedDB • No server logs</span>
        </div>
        
        {!contact.mutual && (
          <div className="bg-yellow-500/10 text-yellow-500 p-4 rounded-xl text-sm text-center border border-yellow-500/20 shadow-lg">
            You can only message contacts who have also added you. 
          </div>
        )}
        
        {decryptedMessages.map(msg => {
          const isMe = msg.senderId === userId;
          let meta = { name: '', type: '' };
          if (msg.type !== 'text') {
            try { meta = JSON.parse(msg.plainContent); } catch(e){}
          }
          
          let touchTimeout: NodeJS.Timeout;
          
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`flex items-start gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isMe ? 'bg-emerald-600 text-black' : 'bg-slate-700 text-slate-300'}`}>
                {isMe ? 'ME' : contact.alias.charAt(0).toUpperCase()}
              </div>
              <div className="max-w-[75%] sm:max-w-sm min-w-0 relative">
                <div 
                  id={`msg-bubble-${msg.id}`}
                  className={`p-4 shadow-xl cursor-pointer select-none transition-colors duration-500 ${isMe ? 'bg-emerald-600/20 border border-emerald-500/30 rounded-2xl rounded-tr-none' : 'bg-slate-800 rounded-2xl rounded-tl-none'}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuMsgId(msg.id);
                    setContextMenuPos({ x: e.clientX, y: e.clientY });
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    touchTimeout = setTimeout(() => {
                      setContextMenuMsgId(msg.id);
                      setContextMenuPos({ x: touch.clientX, y: touch.clientY });
                    }, 500);
                  }}
                  onTouchEnd={() => clearTimeout(touchTimeout)}
                  onTouchMove={() => clearTimeout(touchTimeout)}
                >
                  {msg.replyTo && (() => {
                    const originalMsg = decryptedMessages.find(m => m.id === msg.replyTo);
                    if (!originalMsg) return null;
                    return (
                      <div 
                        className="mb-2 bg-black/20 hover:bg-black/40 transition-colors cursor-pointer border border-slate-700/30 rounded-lg p-2 flex items-start justify-between relative overflow-hidden text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = document.getElementById(`msg-${msg.replyTo}`);
                          const bubble = document.getElementById(`msg-bubble-${msg.replyTo}`);
                          if (el && bubble) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            const originalBg = bubble.style.backgroundColor;
                            bubble.style.backgroundColor = 'rgba(52, 211, 153, 0.4)'; // emerald-400/40
                            setTimeout(() => {
                              bubble.style.backgroundColor = originalBg;
                            }, 1000);
                          }
                        }}
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/50"></div>
                        <div className="flex-1 min-w-0 pl-1 opacity-80">
                          <p className="font-bold text-emerald-400/80 mb-0.5">
                            {originalMsg.senderId === userId ? 'You' : contact.alias}
                          </p>
                          <p className="text-slate-300 truncate">
                            {originalMsg.type === 'text' ? originalMsg.plainContent :
                             originalMsg.type === 'image' ? '📸 Photo' :
                             originalMsg.type === 'audio' ? '🎤 Voice Message' :
                             originalMsg.type === 'video' ? '🎥 Video' :
                             originalMsg.type === 'call' ? '📞 Call' : '📎 File'}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  {msg.type === 'text' && (
                    <p className={`text-sm ${isMe ? 'text-emerald-100' : 'text-slate-200'} whitespace-pre-wrap break-words break-all`}>{msg.plainContent}</p>
                  )}
                  {msg.type === 'image' && msg.plainFile && (
                    <ImageAttachment buffer={msg.plainFile} mimeType={meta.type} name={meta.name} onDownload={() => downloadFile(msg.plainFile!, meta.name, meta.type)} />
                  )}
                  {msg.type === 'audio' && msg.plainFile && (
                    <AudioPlayer buffer={msg.plainFile} mimeType={meta.type} isMe={isMe} />
                  )}
                  {msg.type === 'video' && msg.plainFile && (
                    <VideoAttachment buffer={msg.plainFile} mimeType={meta.type} name={meta.name} onDownload={() => downloadFile(msg.plainFile!, meta.name, meta.type)} />
                  )}
                  {msg.type === 'file' && msg.plainFile && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isMe ? 'bg-emerald-500/20' : 'bg-slate-700/50'}`}>
                      <Paperclip className={`w-5 h-5 ${isMe ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-bold text-slate-200">{meta.name}</p>
                        <p className="text-[10px] opacity-70 text-slate-400">{(msg.plainFile.byteLength / 1024).toFixed(1)} KB</p>
                      </div>
                      <button onClick={() => downloadFile(msg.plainFile!, meta.name, meta.type)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-300">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {msg.type === 'call' && (() => {
                    let callMeta: { callId: string; callerId: string; receiverId: string; status: 'calling' | 'ongoing' | 'completed' | 'missed'; duration: number } = { 
                      callId: msg.id, 
                      callerId: msg.senderId, 
                      receiverId: '', 
                      status: 'calling', 
                      duration: 0 
                    };
                    try {
                      if (msg.plainContent) callMeta = { ...callMeta, ...JSON.parse(msg.plainContent) };
                    } catch(e){}

                    const isCaller = callMeta.callerId === userId || msg.senderId === userId;
                    const isMissed = callMeta.status === 'missed';
                    const isCallingStatus = callMeta.status === 'calling';
                    const isOngoingStatus = callMeta.status === 'ongoing';
                    const isCompletedStatus = callMeta.status === 'completed';

                    const titleText = (isMissed && !isCaller) ? 'Missed call' : 'Call';
                    let subtitleText = '';

                    if (isCallingStatus) {
                      subtitleText = 'Calling..';
                    } else if (isOngoingStatus) {
                      subtitleText = 'Call in progress';
                    } else if (isCompletedStatus) {
                      const secs = callMeta.duration || 0;
                      if (!secs || secs <= 0) {
                        subtitleText = '0 sec';
                      } else {
                        const m = Math.floor(secs / 60);
                        const s = secs % 60;
                        if (m === 0) {
                          subtitleText = `${s} sec`;
                        } else if (s === 0) {
                          subtitleText = `${m} min`;
                        } else {
                          subtitleText = `${m} min ${s} sec`;
                        }
                      }
                    } else if (isMissed) {
                      if (isCaller) {
                        subtitleText = 'No answer';
                      } else {
                        subtitleText = 'Click to call back';
                      }
                    }

                    const canCallBack = isMissed && !isCaller && contact.online && contact.mutual && !isInCall && !isReceivingCall && !isCalling;

                    return (
                      <div 
                        className={`flex items-center gap-3 p-3 rounded-xl transition-all select-none ${
                          isMissed 
                            ? 'bg-red-500/10 border border-red-500/20' 
                            : isMe 
                              ? 'bg-emerald-500/20 border border-emerald-500/30' 
                              : 'bg-slate-700/50 border border-slate-600/30'
                        } ${canCallBack ? 'cursor-pointer hover:bg-red-500/20 hover:border-red-500/40 active:scale-98' : ''}`}
                        onClick={(e) => {
                          if (canCallBack) {
                            e.stopPropagation();
                            startCall();
                          }
                        }}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          isMissed ? 'bg-red-500/20 text-red-500 border border-red-500/30' : isMe ? 'bg-emerald-500/30 text-emerald-300' : 'bg-slate-600 text-slate-200'
                        }`}>
                          {isCaller ? (
                            <PhoneOutgoing className="w-5 h-5" />
                          ) : (
                            <PhoneIncoming className="w-5 h-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${isMissed ? 'text-red-400' : 'text-slate-100'}`}>
                            {titleText}
                          </p>
                          <p className={`text-xs truncate ${isMissed ? 'text-red-300/80 font-medium' : 'text-slate-400'}`}>
                            {subtitleText}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className={`flex items-center gap-1 mt-1 text-[9px] text-slate-500 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {chatExpiresAt && <span>• TTL: {Math.max(0, Math.round((chatExpiresAt - Date.now())/60000))}m left</span>}
                  {isMe && msg.type !== 'call' && (
                    <span className="ml-0.5 flex items-center">
                      {msg.status === 'read' ? <CheckCheck className="w-3 h-3 text-blue-400" /> :
                       msg.status === 'delivered' ? <Check className="w-3 h-3 text-blue-400" /> :
                       <Check className="w-3 h-3 text-slate-400" />}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {contextMenuMsgId && (
          <div 
            className="fixed z-50 bg-[#16191F] border border-slate-700 rounded-lg shadow-2xl py-1 flex flex-col min-w-[150px]"
            style={{ top: Math.min(contextMenuPos.y, window.innerHeight - 100), left: Math.min(contextMenuPos.x, window.innerWidth - 160) }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const msg = decryptedMessages.find(m => m.id === contextMenuMsgId);
              if (msg && msg.type === 'text') {
                return (
                  <button 
                    className="px-4 py-2 text-sm text-left text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.plainContent);
                      setContextMenuMsgId(null);
                    }}
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </button>
                );
              }
              return null;
            })()}
            <button 
              className="px-4 py-2 text-sm text-left text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2"
              onClick={() => {
                const msg = decryptedMessages.find(m => m.id === contextMenuMsgId);
                if (msg) setReplyingTo(msg);
                setContextMenuMsgId(null);
              }}
            >
              <Reply className="w-4 h-4" />
              <span>Reply</span>
            </button>
            <button 
              className="px-4 py-2 text-sm text-left text-red-500 hover:bg-slate-800 transition-colors flex items-center gap-2"
              onClick={async () => {
                await db.messages.delete(contextMenuMsgId);
                setContextMenuMsgId(null);
              }}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              <span>Delete for me</span>
            </button>
            <button 
              className="px-4 py-2 text-sm text-left text-red-500 hover:bg-slate-800 transition-colors flex items-center gap-2"
              onClick={async () => {
                await db.messages.delete(contextMenuMsgId);
                rtcManager.sendDeleteMessage(contact.contactId, contextMenuMsgId);
                setContextMenuMsgId(null);
              }}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              <span>Delete for all</span>
            </button>
          </div>
        )}
        {isRemoteTyping && (
          <div className="flex justify-start">
            <div className="bg-[#1A1D24] border border-slate-700/50 p-4 rounded-2xl rounded-tl-none">
               <div className="flex gap-1 items-center h-4">
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                 <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
               </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Footer */}
      <footer className="p-4 sm:p-6 bg-[#0F1115] border-t border-slate-800 w-full min-w-0">
        <div className="flex items-center gap-4 mb-4 justify-between">
          <div className="flex items-center gap-1.5 bg-slate-800/60 hover:bg-slate-700/60 transition-colors px-2.5 py-1.5 rounded-lg border border-slate-700/50 relative">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">TTL:</label>
            <div className="relative flex items-center">
              <select 
                value={expiresIn} 
                onChange={e => setExpiresIn(Number(e.target.value))}
                className="bg-transparent text-[11px] font-bold text-emerald-400 focus:outline-none appearance-none cursor-pointer pr-4 pl-1 z-10 w-full"
              >
                <option value={0} className="bg-slate-800 text-slate-200">Manual</option>
                <option value={1} className="bg-slate-800 text-slate-200">1 Min</option>
                <option value={5} className="bg-slate-800 text-slate-200">5 Min</option>
                <option value={10} className="bg-slate-800 text-slate-200">10 Min</option>
                <option value={30} className="bg-slate-800 text-slate-200">30 Min</option>
                <option value={60} className="bg-slate-800 text-slate-200">1 Hour</option>
              </select>
              <ChevronDown className="w-3 h-3 text-emerald-500 absolute right-0 pointer-events-none" />
            </div>
          </div>
          <div className="text-[10px] text-slate-500">
            Storage: <span className="text-slate-300">IndexedDB Cached</span>
          </div>
        </div>

        {replyingTo && (
          <div className="mb-2 bg-[#1A1D24] border border-slate-700 rounded-xl p-3 flex items-start justify-between relative overflow-hidden w-full max-w-full">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
            <div className="flex-1 min-w-0 pl-2 pr-2">
              <p className="text-xs font-bold text-emerald-500 mb-1">
                Replying to {replyingTo.senderId === userId ? 'yourself' : contact.alias}
              </p>
              <p className="text-sm text-slate-300 truncate">
                {replyingTo.type === 'text' ? replyingTo.plainContent :
                 replyingTo.type === 'image' ? '📸 Photo' :
                 replyingTo.type === 'audio' ? '🎤 Voice Message' :
                 replyingTo.type === 'video' ? '🎥 Video' : '📎 File'}
              </p>
            </div>
            <button 
              type="button" 
              onClick={() => setReplyingTo(null)}
              className="p-1 hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSendText} className="flex items-center gap-1 sm:gap-4">
          {/* Desktop Attachment Button */}
          <label className="text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer p-2 hidden sm:block" title="Adjuntar archivo">
            <Paperclip className="w-5 h-5" />
            <input type="file" accept="image/*,video/*,audio/*,application/*,text/*" className="hidden" onChange={handleFileUpload} disabled={!contact.mutual || !contact.online} />
          </label>

          {/* Mobile Attachment Menu */}
          <div className="relative sm:hidden" ref={attachmentMenuRef}>
            <button
              type="button"
              className="text-slate-400 hover:text-emerald-400 transition-colors p-2"
              onClick={(e) => {
                e.stopPropagation();
                setShowAttachmentMenu(!showAttachmentMenu);
              }}
              disabled={!contact.mutual || !contact.online}
            >
              <Plus className="w-6 h-6" />
            </button>
            
            {showAttachmentMenu && (
              <div className="absolute bottom-12 left-0 bg-[#16191F] border border-slate-700 rounded-2xl shadow-xl p-2 flex flex-col gap-1 z-50 mb-2 w-48 animate-in fade-in zoom-in-95 duration-200">
                <label className="flex items-center gap-3 text-slate-300 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer p-3 rounded-xl" onClick={() => setShowAttachmentMenu(false)}>
                  <Paperclip className="w-5 h-5" />
                  <span className="text-sm font-medium">Archivo</span>
                  <input type="file" accept="image/*,video/*,audio/*,application/*,text/*" className="hidden" onChange={handleFileUpload} />
                </label>
                <label className="flex items-center gap-3 text-slate-300 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer p-3 rounded-xl" onClick={() => setShowAttachmentMenu(false)}>
                  <Camera className="w-5 h-5" />
                  <span className="text-sm font-medium">Foto</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileUpload} />
                </label>
                <label className="flex items-center gap-3 text-slate-300 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer p-3 rounded-xl" onClick={() => setShowAttachmentMenu(false)}>
                  <Video className="w-5 h-5" />
                  <span className="text-sm font-medium">Video</span>
                  <input type="file" accept="video/*" capture="environment" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            )}
          </div>
          
          <div className="flex-1 bg-[#16191F] border border-slate-700 rounded-xl px-2 sm:px-4 py-2 sm:py-3 flex items-center relative" ref={emojiPickerRef}>
            <button 
              type="button"
              className="text-slate-400 hover:text-emerald-400 transition-colors p-2"
              onClick={(e) => {
                e.stopPropagation();
                setShowEmojiPicker(!showEmojiPicker);
              }}
            >
              <Smile className="w-5 h-5" />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 sm:left-0 mb-2 z-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <EmojiPicker 
                  theme={Theme.DARK}
                  emojiStyle={EmojiStyle.APPLE}
                  skinTonesDisabled={true}
                  previewConfig={{ showPreview: false }}
                  onEmojiClick={(emojiData) => {
                    setInputText(prev => prev + emojiData.emoji);
                  }}
                />
              </div>
            )}
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              onBlur={() => rtcManager.sendTyping(contact.contactId, false)}
              disabled={!contact.mutual || !contact.online}
              placeholder={contact.mutual && contact.online ? "Write an encrypted message..." : "Waiting for secure connection..."}
              className="bg-transparent w-full text-sm text-slate-200 focus:outline-none disabled:opacity-50"
            />
          </div>
          
          {inputText ? (
             <button type="submit" disabled={!contact.mutual || !contact.online} className="w-12 h-12 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-lg shadow-emerald-500/20 disabled:opacity-50 hover:bg-emerald-400 transition-colors">
               <Send className="w-5 h-5 ml-1" />
             </button>
          ) : (
             <AudioRecorder contact={contact} replyingToId={replyingTo?.id} onSendAudio={() => setReplyingTo(null)} />
          )}
        </form>
      </footer>

      {filePreview && (
        <div className="absolute inset-0 z-50 bg-[#0F1115]/95 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#1A1D24] border border-slate-700/50 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/30">
              <h3 className="font-bold text-slate-200">Send {filePreview.type === 'video' ? 'Video' : 'Photo'}</h3>
              <button onClick={cancelFilePreview} className="p-1 hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 bg-black/20 flex-1 flex items-center justify-center min-h-[300px]">
              {filePreview.type === 'video' ? (
                <video src={filePreview.url} controls className="max-w-full max-h-[60vh] object-contain rounded-lg" />
              ) : (
                <img src={filePreview.url} alt="Preview" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
              )}
            </div>

            <div className="p-4 bg-slate-800/30 flex justify-end gap-3">
              <button 
                onClick={cancelFilePreview}
                className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-700 transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={sendFilePreview}
                className="px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
              >
                Send <Send className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Separate component for Audio Recording
function AudioRecorder({ contact, replyingToId, onSendAudio }: { contact: Contact, replyingToId?: string, onSendAudio?: () => void }) {
  const [recording, setRecording] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewBuffer, setPreviewBuffer] = useState<ArrayBuffer | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const shouldDiscardRef = useRef<boolean>(false);

  const startRecording = async () => {
    if (!contact.mutual || !contact.online) return;
    setPermissionError(false);
    setRecordingDuration(0);
    shouldDiscardRef.current = false;
    setPreviewBlob(null);
    setPreviewBuffer(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      
      mr.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop()); // stop mic
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        
        if (!shouldDiscardRef.current && chunksRef.current.length > 0) {
          setPreviewBlob(blob);
          const buffer = await blob.arrayBuffer();
          setPreviewBuffer(buffer);
        }
      };
      
      mr.start();
      setRecording(true);
      timerIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      console.error("Audio recording failed", err);
      setPermissionError(true);
      setTimeout(() => setPermissionError(false), 3000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const sendPreview = async () => {
    if (!previewBlob || !previewBuffer) return;
    await rtcManager.connectToContact(contact.contactId);
    await rtcManager.sendFile(contact.contactId, previewBuffer, 'audio', { name: 'Voice Message', type: 'audio/webm' }, undefined, replyingToId);
    setPreviewBlob(null);
    setPreviewBuffer(null);
    if (onSendAudio) onSendAudio();
  };

  const discardPreview = () => {
    setPreviewBlob(null);
    setPreviewBuffer(null);
  };

  if (permissionError) {
    return (
      <div className="flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-4 h-12">
        <span className="text-xs font-bold whitespace-nowrap">Mic Access Denied</span>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (previewBlob && previewBuffer) {
    return (
      <div className="flex items-center gap-3 bg-slate-800 rounded-full pl-2 pr-4 h-12 border border-slate-700">
        <AudioPlayer buffer={previewBuffer} mimeType="audio/webm" isMe={true} isPreview={true} />
        <button type="button" onClick={discardPreview} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={sendPreview} className="w-8 h-8 flex items-center justify-center rounded-full bg-emerald-500 text-black hover:bg-emerald-400 transition-colors">
          <Send className="w-4 h-4 ml-[-2px]" />
        </button>
      </div>
    );
  }

  return recording ? (
    <div className="flex items-center gap-2 animate-pulse bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-4 h-12">
      <span className="text-sm font-bold whitespace-nowrap">{formatDuration(recordingDuration)}</span>
      <button type="button" onClick={stopRecording} className="p-2 hover:bg-red-500/20 rounded-full transition-colors text-emerald-400">
        <Check className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => { 
         shouldDiscardRef.current = true;
         mediaRecorderRef.current?.stop();
         setRecording(false);
         if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      }} className="p-2 hover:bg-red-500/20 rounded-full transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : (
    <button type="button" disabled={!contact.mutual || !contact.online} onMouseDown={startRecording} className="w-12 h-12 rounded-full flex-shrink-0 bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-emerald-400 transition-colors disabled:opacity-50">
      <Mic className="w-5 h-5" />
    </button>
  );
}

function AudioPlayer({ buffer, mimeType, isMe, isPreview }: { buffer: ArrayBuffer, mimeType: string, isMe: boolean, isPreview?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string>('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  useEffect(() => {
    const blob = new Blob([buffer], { type: mimeType });
    const objUrl = URL.createObjectURL(blob);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [buffer, mimeType]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    setupWebAudio();
    drawWaveform();
  };
  
  const handlePause = () => {
    setIsPlaying(false);
    cancelAnimationFrame(animationRef.current);
  };
  
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    cancelAnimationFrame(animationRef.current);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const formatAudioTime = (time: number) => {
    if (!isFinite(time) || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const setupWebAudio = () => {
    if (!audioRef.current || audioContextRef.current) return;
    // We only set this up once
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    try {
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.8; // Amplifies voice message playback volume by 80%

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      
      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(gainNode);
      gainNode.connect(compressor);
      compressor.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (e) {
      console.error("Web Audio API setup failed", e);
    }
  };

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        ctx.fillStyle = isMe ? 'rgba(167,243,208,0.8)' : 'rgba(148,163,184,0.8)';
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  return (
    <div className={`flex items-center gap-3 w-48 ${isMe ? 'text-emerald-100' : 'text-slate-200'}`}>
      <button onClick={togglePlay} className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isMe ? 'bg-emerald-500 text-black' : 'bg-slate-600 text-slate-200'} hover:opacity-80 transition-opacity`}>
        {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-8 rounded relative overflow-hidden flex items-center justify-center w-full">
          <canvas ref={canvasRef} width={120} height={32} className="absolute inset-0 w-full h-full" />
          {!isPlaying && <div className="absolute inset-0 flex items-center justify-center opacity-50"><span className="w-full h-0.5 bg-current rounded-full"></span></div>}
        </div>
        {!isPreview && (
          <div className="text-[10px] opacity-70 mt-0.5 font-mono text-right">
            {isPlaying || currentTime > 0 ? formatAudioTime(currentTime) : formatAudioTime(duration)}
          </div>
        )}
      </div>
      <audio 
        ref={audioRef} 
        src={url} 
        onPlay={handlePlay} 
        onPause={handlePause} 
        onEnded={handleEnded} 
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="hidden" 
        crossOrigin="anonymous"
      />
    </div>
  );
}

function ImageAttachment({ buffer, mimeType, name, onDownload }: { buffer: ArrayBuffer, mimeType: string, name: string, onDownload: () => void }) {
  const [url, setUrl] = useState<string>('');
  
  useEffect(() => {
    const blob = new Blob([buffer], { type: mimeType });
    const objUrl = URL.createObjectURL(blob);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [buffer, mimeType]);
  
  if (!url) return null;
  
  return (
    <div className="space-y-2">
      <img src={url} alt={name} className="max-w-full rounded-lg" />
      <button onClick={onDownload} className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100 text-emerald-400">
        <Download className="w-3 h-3" /> Download {name}
      </button>
    </div>
  );
}

function VideoAttachment({ buffer, mimeType, name, onDownload }: { buffer: ArrayBuffer, mimeType: string, name: string, onDownload: () => void }) {
  const [url, setUrl] = useState<string>('');
  
  useEffect(() => {
    const blob = new Blob([buffer], { type: mimeType });
    const objUrl = URL.createObjectURL(blob);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [buffer, mimeType]);
  
  if (!url) return null;
  
  return (
    <div className="space-y-2">
      <video src={url} controls className="max-w-full rounded-lg" />
      <button onClick={onDownload} className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100 text-emerald-400">
        <Download className="w-3 h-3" /> Download {name}
      </button>
    </div>
  );
}