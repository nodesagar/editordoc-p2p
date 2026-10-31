import { jsx as _jsx } from "react/jsx-runtime";
export const Highlighter = ({ children, action = 'highlight', color = '#87CEFA', }) => {
    if (action === 'underline') {
        return (_jsx("span", { className: "relative inline-block font-semibold", style: {
                borderBottom: `2.5px solid ${color}`,
                paddingBottom: '2px',
            }, children: children }));
    }
    return (_jsx("span", { className: "relative inline-block px-1.5 py-0.5 rounded-sm font-medium", style: {
            backgroundColor: color ? `${color}33` : 'rgba(135, 206, 250, 0.25)',
            color: 'inherit',
        }, children: children }));
};
