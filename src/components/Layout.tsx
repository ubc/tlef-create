import { ReactNode } from 'react';
import Sidebar from './Sidebar';

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
    </div>
  );
};

export default Layout;