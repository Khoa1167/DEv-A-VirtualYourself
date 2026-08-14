import { MessageCircle, Users, KeyRound, Palette, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const NavIcon = ({ active, onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className={`btn btn-circle btn-lg ${active ? 'btn-primary text-white' : 'btn-ghost text-base-content/60 hover:text-base-content'}`}
  >
    {children}
  </button>
);

export default function IconRail({ view, onSelectChat, onSelectFriends, onOpenProfile, onOpenKeyBackup }) {
  const { user, logout } = useAuth();
  const { theme, changeTheme, availableThemes } = useTheme();

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

      <div className="dropdown dropdown-right dropdown-bottom">
        <button
          tabIndex={0}
          role="button"
          className="btn btn-circle btn-lg btn-ghost text-base-content/60 hover:text-base-content"
          title="Chọn giao diện"
        >
          <Palette className="w-5 h-5" />
        </button>
        <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[60] w-52 p-2 shadow-lg border border-base-300 max-h-80 overflow-y-auto flex-nowrap">
          {availableThemes.map(t => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => changeTheme(t.id)}
                className={theme === t.id ? 'active' : ''}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-1" />

      <button
        onClick={logout}
        className="btn btn-circle btn-lg btn-ghost text-error/70 hover:text-error hover:bg-error/10"
        title="Đăng xuất"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}
