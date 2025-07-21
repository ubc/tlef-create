import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import NotificationSystem from './NotificationSystem';
import '../styles/components/Layout.css';

interface LayoutProps {
    children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
    return (
        <div className="app-layout">
            <Sidebar />
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