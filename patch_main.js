const fs = require('fs');
let code = fs.readFileSync('src/components/MainLayout.tsx', 'utf8');

const returnStart = code.indexOf('return (');
const patchCode = `return (
    <div className="flex flex-col-reverse md:flex-row h-screen w-full bg-[#0F1115] text-slate-200 font-sans overflow-hidden relative">
      {/* Navigation Bar (Left on Desktop, Bottom on Mobile) */}
      <nav className="flex md:flex-col items-center justify-around md:justify-start bg-[#16191F] md:w-16 w-full h-16 md:h-full border-t md:border-t-0 md:border-r border-slate-800 z-30 shrink-0 md:py-4">
        <button onClick={() => { setActiveTab('chats'); setIsSidebarOpen(true); }} className={\`p-3 md:mb-4 rounded-xl transition-colors flex flex-col items-center gap-1 \${activeTab === 'chats' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}\`}>
          <MessageSquare className="w-6 h-6" />
          <span className="text-[10px] md:hidden font-medium">Chats</span>
        </button>
        <button onClick={() => { setActiveTab('contacts'); setIsSidebarOpen(true); }} className={\`p-3 md:mb-4 rounded-xl transition-colors flex flex-col items-center gap-1 \${activeTab === 'contacts' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}\`}>
          <Users className="w-6 h-6" />
          <span className="text-[10px] md:hidden font-medium">Contacts</span>
        </button>
        <div className="md:mt-auto">
          <button onClick={() => { setActiveTab('settings'); setIsSidebarOpen(true); }} className={\`p-3 rounded-xl transition-colors flex flex-col items-center gap-1 \${activeTab === 'settings' ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}\`}>
            <Settings className="w-6 h-6" />
            <span className="text-[10px] md:hidden font-medium">Settings</span>
          </button>
        </div>
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
        <aside className={\`absolute md:relative z-20 w-full md:w-80 flex flex-col border-r border-slate-800 bg-[#16191F] h-full transition-transform duration-300 \${isSidebarOpen || activeTab === 'contacts' || (activeTab === 'chats' && !activeContact) ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}\`}>
          <div className="p-6 border-b border-slate-800 shrink-0">
            {activeTab === 'contacts' ? (
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-white">Contacts</h3>
                <button 
                  onClick={() => setIsAdding(!isAdding)}
                  className="w-8 h-8 rounded-full bg-emerald-500 text-[#0F1115] flex items-center justify-center hover:bg-emerald-400 transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
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
                placeholder="Search Contacts..."
                className="w-full bg-[#0F1115] border border-slate-700 rounded-lg py-2 px-4 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {contacts.map(contact => {
              const isActive = activeContact?.contactId === contact.contactId;
              const handleContextMenu = (e) => {
                e.preventDefault();
                setDeletingId(contact.contactId);
              };
              let touchTimeout;
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
                  className={\`p-3 flex items-center cursor-pointer rounded-xl transition-colors group select-none \${
                    isActive && activeTab === 'chats' ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-slate-800 opacity-70 border border-transparent'
                  }\`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-700 mr-3 flex-shrink-0 flex items-center justify-center text-lg font-medium text-slate-300 relative">
                    {contact.alias.charAt(0).toUpperCase()}
                    <div className={\`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#16191F] \${contact.online ? 'bg-emerald-500' : 'bg-slate-500'}\`} />
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
                          <span className={\`text-sm font-semibold truncate \${isActive && activeTab === 'chats' ? 'text-white' : ''}\`}>{contact.alias}</span>
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
                        <p className={\`text-xs truncate pr-2 \${isActive ? 'text-slate-400' : (unreadCounts[contact.contactId] > 0 ? 'text-emerald-500' : 'text-slate-500')}\`}>
                          {(() => {
                            const lastMsgData = lastMessages[contact.contactId];
                            const lastMsg = lastMsgData?.message;
                            if (lastMsg) {
                              if (lastMsg.type === 'text') return lastMsgData.plainText || 'Text message';
                              if (lastMsg.type === 'image') return '📷 Image';
                              if (lastMsg.type === 'audio') return '🎤 Voice message';
                              if (lastMsg.type === 'video') return '🎥 Video';
                              if (lastMsg.type === 'file') return '📄 File';
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
                        <p className={\`text-xs truncate pr-2 text-slate-500\`}>
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
          <aside className={\`absolute md:relative z-20 w-full md:w-80 flex flex-col border-r border-slate-800 bg-[#16191F] h-full transition-transform duration-300 \${isSidebarOpen || activeTab === 'settings' ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}\`}>
            <div className="p-6 border-b border-slate-800 shrink-0">
              <h3 className="font-bold text-lg text-white mb-4">Settings</h3>
            </div>
            <div className="p-6 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40 mb-2">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h2 className="text-sm font-bold text-white break-all">ID: {userId}</h2>
                <p className="text-xs text-emerald-400 font-mono tracking-wider uppercase">Session Encrypted</p>
              </div>

              <div className="w-full h-px bg-slate-800 my-2" />

              <button onClick={logout} className="flex items-center gap-3 text-slate-400 hover:text-red-400 transition-colors p-3 rounded-xl hover:bg-slate-800 text-sm font-semibold w-full">
                <LogOut className="w-5 h-5" />
                Logout
              </button>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 flex flex-col relative bg-[#0F1115] hidden md:flex">
          {activeContact && activeTab === 'chats' ? (
            <ChatView contact={activeContact} onOpenMenu={() => { /* Not needed on desktop, maybe back button */ }} />
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
        <main className={\`flex-1 min-w-0 flex flex-col relative bg-[#0F1115] md:hidden \${activeTab === 'chats' && activeContact ? 'absolute inset-0 z-40' : 'hidden'}\`}>
          {activeContact && activeTab === 'chats' && (
            <ChatView contact={activeContact} onOpenMenu={() => { setActiveContact(null); }} />
          )}
        </main>

      </div>
    </div>
  );
}
`;

fs.writeFileSync('src/components/MainLayout.tsx', code.substring(0, returnStart) + patchCode);
