import { ReactNode, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import NotificationSystem from './NotificationSystem';
import '../styles/components/Layout.css';

interface LayoutProps {
    children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="app-layout">
            <button
                className="mobile-menu-button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open menu"
            >
                <Menu size={24} />
            </button>
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
            <div className="main-content">
                <div className="content-area">
                    {children}
                </div>
            </div>
            <NotificationSystem />
        </div>
    );
};

export default Layout;