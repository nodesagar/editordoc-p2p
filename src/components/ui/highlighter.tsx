import React from 'react';

interface HighlighterProps {
  children: React.ReactNode;
  action?: 'highlight' | 'underline' | 'box' | 'circle';
  color?: string;
}

export const Highlighter: React.FC<HighlighterProps> = ({
  children,
  action = 'highlight',
  color = '#87CEFA',
}) => {
  if (action === 'underline') {
    return (
      <span
        className="relative inline-block font-semibold"
        style={{
          borderBottom: `2.5px solid ${color}`,
          paddingBottom: '2px',
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className="relative inline-block px-1.5 py-0.5 rounded-sm font-medium"
      style={{
        backgroundColor: color ? `${color}33` : 'rgba(135, 206, 250, 0.25)',
        color: 'inherit',
      }}
    >
      {children}
    </span>
  );
};
