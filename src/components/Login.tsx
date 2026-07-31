import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { deriveKey, hashSeed } from '../crypto';
import { rtcManager } from '../webrtc';
import { UserContextType } from '../types';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

export default function Login({ onLogin }: { onLogin: (ctx: Omit<UserContextType, 'logout'>) => void }) {
  const [userId, setUserId] = useState('');
  const [seed, setSeed] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    setUserId(uuidv4().replace(/-/g, '').slice(0, 16));
    setSeed(uuidv4() + uuidv4()); // Just a long random string
    setShowSeed(true); // Automatically show the seed when generating a new one
  };

  const handleCopy = async () => {
    if (!seed) return;
    try {
      await navigator.clipboard.writeText(seed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy seed:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !seed) {
      setError("Please provide both ID and Seed Key");
      return;
    }
    setLoading(true);
    setError('');

    try {
      const hashedPass = await hashSeed(seed);
      const aesKey = await deriveKey(seed);
      
      rtcManager.init(userId, aesKey);
      const success = await rtcManager.login(userId, hashedPass);
      
      if (success) {
        onLogin({ userId, seed, aesKey });
      } else {
        setError("Login failed. Check your ID and Seed.");
      }
    } catch (err) {
      setError("An error occurred during cryptographic operations.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F1115] text-slate-200 p-4 font-sans">
      <div className="max-w-md w-full bg-[#16191F] p-8 rounded-2xl border border-slate-800 shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40">
            <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Secure Session</h1>
            <p className="text-[10px] text-emerald-400 font-mono tracking-wider uppercase">End-to-End Encrypted</p>
          </div>
        </div>
        <p className="text-slate-400 text-sm mb-8">
          Enter your unique ID and Seed Key. If the ID does not exist, it will be registered automatically.
        </p>

        {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest">Unique ID</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full bg-[#0F1115] border border-slate-700 rounded-lg px-4 py-3 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="e.g. 7f8a9b2c..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest">Seed Key (Keep Secret!)</label>
            <div className="relative">
              <input
                type={showSeed ? "text" : "password"}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-full bg-[#0F1115] border border-slate-700 rounded-lg pl-4 pr-24 py-3 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="Your extremely long secure seed..."
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSeed(!showSeed)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                  title={showSeed ? "Hide seed" : "Show seed"}
                >
                  {showSeed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                  title="Copy seed"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={handleGenerate}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 px-4 rounded-lg transition-colors text-xs flex items-center justify-center gap-2"
            >
              Generate New
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-3 px-4 rounded-lg transition-colors text-xs disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {loading ? "Decrypting..." : "Access"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
