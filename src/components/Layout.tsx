import { ReactNode, useState } from 'react';
import { Menu, PanelLeftOpen } from 'lucide-react';
import Sidebar from './Sidebar';
import NotificationSystem from './NotificationSystem';
import CreateGuide from './help/CreateGuide';
import '../styles/components/Layout.css';

interface LayoutProps {
    children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('create-sidebar-collapsed') === 'true'; } catch { return false; } });
    const toggleSidebar = () => setCollapsed(value => {
        try { localStorage.setItem('create-sidebar-collapsed', String(!value)); } catch { /* Storage may be unavailable. */ }
        return !value;
    });

    return (
        <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
            {collapsed && <div className="sidebar-rail"><button onClick={toggleSidebar} aria-label="Expand sidebar" aria-expanded={false}><PanelLeftOpen size={21} /></button></div>}
            <button
                className="mobile-menu-button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open menu"
            >
                <Menu size={24} />
            </button>
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleSidebar} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
            <main className="main-content">
                <div className="content-area">
                    {children}
                </div>
            </main>
            <NotificationSystem />
            <CreateGuide />
        </div>
    );
};

export default Layout;
