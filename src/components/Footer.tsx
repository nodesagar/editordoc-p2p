import React from 'react';
import { ShieldCheck, Heart, Github, Globe } from 'lucide-react';

interface FooterProps {
  onOpenPrivacyModal: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenPrivacyModal }) => {
  return (
    <footer className="border-t border-black/[0.08] bg-[#faf9f8] py-8 px-4 md:px-8 mt-auto">
      <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#625e5a]">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-md bg-[#005db2] text-white flex items-center justify-center font-bold text-[10px]">
            ED
          </div>
          <span className="font-semibold text-[#1a1c1c]">EditorDoc P2P</span>
          <span>&bull;</span>
          <span>Offline-first, CRDT-powered collaborative document editor</span>
        </div>

        <div className="flex items-center space-x-6">
          <button
            onClick={onOpenPrivacyModal}
            className="hover:text-[#005db2] transition-colors cursor-pointer"
          >
            P2P Guarantee & Terms
          </button>
          <span>&bull;</span>
          <span className="flex items-center space-x-1">
            <span>SDG 9.c: Universal Computing Access</span>
          </span>
        </div>
      </div>
    </footer>
  );
};
