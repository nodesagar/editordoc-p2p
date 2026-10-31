import React, { useState, useEffect } from 'react';
import { ActiveTool, SyncStatus } from '../types';
import { ShieldCheck, ChevronDown, FileText, Layers, Archive, EyeOff, Scissors, PenTool, ShieldAlert, Menu, X, Stamp, Lock, FileSpreadsheet, Sparkles } from 'lucide-react';
import { CollaborationBar } from './CollaborationBar';

interface HeaderProps {
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
  onOpenPrivacyModal: () => void;
  documentId: string | null;
  syncStatus: SyncStatus;
  peerCount: number;
  onExportSync: () => void;
  onImportSync: (file: File) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTool,
  setActiveTool,
  onOpenPrivacyModal,
  documentId,
  syncStatus,
  peerCount,
  onExportSync,
  onImportSync,
}) => {
  const [showMoreDropdown, setShowMoreDropdown] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-40 bg-[#faf9f8]/95 backdrop-blur-md px-4 md:px-8 py-2.5 transition-all duration-200 border-b ${isScrolled ? 'border-black/[0.08]' : 'border-transparent'}`}>
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div
          onClick={() => {
            setActiveTool('dashboard');
            setIsMobileMenuOpen(false);
          }}
          className="flex items-center space-x-2.5 cursor-pointer group shrink-0"
        >
          <div className="w-8 h-8 rounded-lg bg-[#005db2] flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M12 18v-6" />
              <path d="M8 15h8" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5">
              <span className="text-lg font-bold tracking-tight text-[#1a1c1c] font-sans">
                EditorDoc
              </span>
              <span className="text-[10px] uppercase font-bold tracking-widest bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-300">
                P2P
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Links (Desktop) */}
        <nav className="hidden lg:flex items-center space-x-1 text-sm font-medium text-[#414753]">
          <button
            onClick={() => setActiveTool('dashboard')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'dashboard' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Dashboard
          </button>

          <button
            onClick={() => setActiveTool('edit')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'edit' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Edit
          </button>

          <button
            onClick={() => setActiveTool('organize')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'organize' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Organize
          </button>

          <button
            onClick={() => setActiveTool('redact')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'redact' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Redact
          </button>

          <button
            onClick={() => setActiveTool('sign')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'sign' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Sign
          </button>

          <button
            onClick={() => setActiveTool('compress')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'compress' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Compress
          </button>

          <button
            onClick={() => setActiveTool('merge')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeTool === 'merge' ? 'text-[#005db2] font-semibold bg-[#005db2]/10' : 'hover:text-[#1a1c1c]'
            }`}
          >
            Merge
          </button>
        </nav>

        {/* Right side: Collaboration Bar & Privacy */}
        <div className="flex items-center space-x-2">
          <CollaborationBar
            documentId={documentId}
            syncStatus={syncStatus}
            peerCount={peerCount}
            onExportSync={onExportSync}
            onImportSync={onImportSync}
          />

          <button
            onClick={onOpenPrivacyModal}
            className="hidden sm:flex items-center space-x-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>P2P Guarantee</span>
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-1.5 text-black/70 hover:text-black rounded-md"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden pt-3 pb-2 border-t border-black/10 mt-2 space-y-1">
          {['dashboard', 'edit', 'organize', 'redact', 'sign', 'compress', 'merge', 'split', 'watermark', 'encrypt'].map((t) => (
            <button
              key={t}
              onClick={() => {
                setActiveTool(t as ActiveTool);
                setIsMobileMenuOpen(false);
              }}
              className={`block w-full text-left px-3 py-2 rounded-md capitalize text-sm ${
                activeTool === t ? 'bg-[#005db2]/10 text-[#005db2] font-semibold' : 'text-[#414753] hover:bg-black/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};
