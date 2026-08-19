import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider } from './context/ThemeContext';
import Login       from './components/Auth/Login';
import Register    from './components/Auth/Register';
import SetNickname from './components/Auth/SetNickname';
import ChatPage    from './pages/ChatPage';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Đang tải...</div>;
  return user ? (
    <SocketProvider>
      {children}
    </SocketProvider>
  ) : <Navigate to="/login" state={{ from: location }} replace />;
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login"        element={<Login />} />
            <Route path="/register"     element={<Register />} />
            <Route path="/set-nickname" element={<SetNickname />} />
            <Route path="/" element={
              <PrivateRoute>
                <ChatPage />
              </PrivateRoute>
            } />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
