import { useState } from 'react';
import { MessageCircle, Users, KeyRound, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Modal from '../common/Modal';

const NavIcon = ({ active, onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className={`btn btn-circle btn-lg ${active ? 'btn-primary text-white' : 'btn-ghost text-base-content/60 hover:text-base-content'}`}
  >
    {children}
  </button>
);

export default function IconRail({ view, onSelectChat, onSelectFriends, onOpenProfile, onOpenKeyBackup, onOpenSettings }) {
  const { user, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="w-20 flex-shrink-0 flex flex-col items-center py-5 gap-3 bg-base-200 border-r border-base-300">
      <div
        className="avatar cursor-pointer hover:opacity-90 transition-opacity mb-2"
        onClick={onOpenProfile}
        title="Cài đặt cá nhân"
      >
        <div className="w-11 rounded-full ring-2 ring-primary/40">
          {user.avatar ? (
            <img src={user.avatar} alt="avatar" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-primary text-primary-content font-bold">
              {(user.nickname || user.username)[0].toUpperCase()}
            </div>
          )}
        </div>
      </div>

      <NavIcon active={view === 'chat'} onClick={onSelectChat} title="Đoạn chat">
        <MessageCircle className="w-5 h-5" />
      </NavIcon>
      <NavIcon active={view === 'friends'} onClick={onSelectFriends} title="Bạn bè">
        <Users className="w-5 h-5" />
      </NavIcon>
      <NavIcon onClick={onOpenKeyBackup} title="Sao lưu & Khôi phục Khóa E2EE">
        <KeyRound className="w-5 h-5" />
      </NavIcon>
      <NavIcon onClick={onOpenSettings} title="Cài đặt">
        <Settings className="w-5 h-5" />
      </NavIcon>

      <div className="flex-1" />

      <button
        onClick={() => setShowLogoutConfirm(true)}
        className="btn btn-circle btn-lg btn-ghost text-error/70 hover:text-error hover:bg-error/10"
        title="Đăng xuất"
      >
        <LogOut className="w-5 h-5" />
      </button>

      {showLogoutConfirm && (
        <Modal onClose={() => setShowLogoutConfirm(false)} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
          <h3 className="text-base font-bold mb-2">Đăng xuất khỏi tài khoản?</h3>
          <p className="text-xs text-base-content/60 mb-4">
            Bạn sẽ cần đăng nhập lại để tiếp tục sử dụng.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setShowLogoutConfirm(false)} className="btn btn-sm btn-ghost bg-base-200 rounded-full">
              Hủy
            </button>
            <button onClick={logout} className="btn btn-sm bg-error text-white hover:bg-error/90 rounded-full">
              Đăng xuất
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
