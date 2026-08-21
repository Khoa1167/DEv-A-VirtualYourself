import { useState, useEffect } from 'react';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import Toast from '../common/Toast';
import Modal from '../common/Modal';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import useTimedMessage from '../../hooks/useTimedMessage';
import SafetyNumberModal from '../Chat/SafetyNumberModal';
import { formatDistanceToNow, format } from 'date-fns';
import { vi } from 'date-fns/locale';

export default function OtherUserProfileModal({ userId, onClose, onSelectRoom, onInitiateCall }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const { on, emit } = useSocket();

  const [alias, setAlias] = useState('');
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [aliasLoading, setAliasLoading] = useState(false);
  const [actionError, showActionError] = useTimedMessage();
  const [actionSuccess, showActionSuccess] = useTimedMessage();

  // Load thông tin profile
  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get(`/friends/profile/${userId}`);
      setProfile(data);
      setAlias(data.customAlias || '');
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể tải thông tin người dùng');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAlias = async () => {
    setAliasLoading(true);
    try {
      const { data } = await api.put(`/friends/alias/${userId}`, { alias });
      setProfile(prev => ({ ...prev, customAlias: data.customAlias }));
      setIsEditingAlias(false);
    } catch (err) {
      showActionError(err.response?.data?.message || 'Không thể lưu biệt danh');
    } finally {
      setAliasLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchProfile();
    }
  }, [userId]);

  // Lắng nghe sự kiện socket cập nhật trạng thái online/offline của user này
  useEffect(() => {
    if (!profile?.user?._id) return;

    const updateStatus = (socketUserId, isOnline) => {
      if (socketUserId?.toString() === profile.user._id?.toString()) {
        setProfile(prev => prev ? {
          ...prev,
          user: {
            ...prev.user,
            isOnline,
            lastSeen: new Date(),
          }
        } : null);
      }
    };

    const offOnline = on('user:online', ({ userId }) => updateStatus(userId, true));
    const offOffline = on('user:offline', ({ userId }) => updateStatus(userId, false));

    return () => {
      offOnline();
      offOffline();
    };
  }, [profile?.user?._id, on]);

  // ── Xử lý các nút hành động ──
  
  // Gửi lời mời kết bạn
  const handleSendRequest = async () => {
    setActionLoading(true);
    try {
      const { data } = await api.post(`/friends/request/${userId}`);
      // Báo realtime cho người nhận, giống FriendList.jsx — không thì họ chỉ thấy sau khi F5.
      emit('friend:request', { receiverId: userId, friendship: data });
      setProfile(prev => ({ ...prev, friendshipStatus: 'pending_sent' }));
      showActionSuccess('Đã gửi lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Gửi lời mời thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Hủy lời mời đã gửi
  const handleCancelRequest = async () => {
    setActionLoading(true);
    try {
      await api.delete(`/friends/cancel/${userId}`);
      setProfile(prev => ({ ...prev, friendshipStatus: 'none', friendshipId: null }));
      showActionSuccess('Đã hủy lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Hủy lời mời thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Chấp nhận lời mời kết bạn
  const handleAcceptRequest = async () => {
    if (!profile.friendshipId) return;
    setActionLoading(true);
    try {
      await api.put(`/friends/accept/${profile.friendshipId}`);
      setProfile(prev => ({ ...prev, friendshipStatus: 'accepted' }));
      showActionSuccess('Kết bạn thành công');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Chấp nhận thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Từ chối lời mời
  const handleRejectRequest = async () => {
    if (!profile.friendshipId) return;
    setActionLoading(true);
    try {
      await api.put(`/friends/reject/${profile.friendshipId}`);
      setProfile(prev => ({ ...prev, friendshipStatus: 'none', friendshipId: null }));
      showActionSuccess('Đã từ chối lời mời kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Từ chối thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Hủy kết bạn
  const handleUnfriend = async () => {
    if (!confirm(`Bạn có chắc chắn muốn hủy kết bạn với ${profile.user.nickname || profile.user.username}?`)) return;
    setActionLoading(true);
    try {
      await api.delete(`/friends/unfriend/${userId}`);
      setProfile(prev => ({ ...prev, friendshipStatus: 'none', friendshipId: null }));
      showActionSuccess('Đã hủy kết bạn');
    } catch (err) {
      showActionError(err.response?.data?.message || 'Hủy kết bạn thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Mở phòng DM nhắn tin
  const handleOpenDM = async () => {
    try {
      const { data: dmRoom } = await api.get(`/friends/dm/${userId}`);
      if (dmRoom && onSelectRoom) {
        onSelectRoom(dmRoom);
        onClose();
      }
    } catch (err) {
      showActionError('Chưa thể mở đoạn chat hoặc chưa có phòng chat riêng.');
    }
  };

  if (!userId) return null;

  return (
    <Modal onClose={onClose} boxClassName="p-0 max-w-md bg-base-100 border border-base-300 shadow-2xl">
        <Toast message={actionError} type="error" z="z-[110]" />
        <Toast message={actionSuccess} type="success" z="z-[110]" />

        {/* Header Bar */}
        <div className="p-4 border-b border-base-300 flex items-center justify-between bg-base-200/50">
          <h2 className="text-base font-bold">Trang cá nhân</h2>
          <button
            className="btn btn-sm btn-ghost bg-base-200 rounded-full"
            onClick={onClose}
          >
            ✕ Đóng
          </button>
        </div>

        {/* Nội dung Modal */}
        <div className="overflow-y-auto max-h-[80vh] p-6 hide-scrollbar flex flex-col gap-6 bg-base-100">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-base-content/40">
              <span className="loading loading-spinner loading-md"></span>
              <span className="text-sm font-medium">Đang tải thông tin...</span>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-error text-sm font-semibold">
              ⚠️ {error}
            </div>
          ) : profile ? (
            <>
              {/* Profile Hero Section */}
              <div className="flex flex-col items-center text-center gap-2">
                {/* Cover Banner */}
                <div className="relative w-full h-32 rounded-xl bg-gradient-to-r from-primary to-secondary overflow-hidden shadow-xs">
                  {profile.user.cover ? (
                    <img src={profile.user.cover} alt="cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-r from-primary to-secondary opacity-90 flex items-center justify-center text-primary-content/30 text-xs font-semibold">
                      Chưa có ảnh bìa
                    </div>
                  )}
                </div>

                {/* Avatar with overlap */}
                <div className={`avatar -mt-12 ${profile.user.isOnline ? 'avatar-online' : 'avatar-offline'}`}>
                  <div className="w-24 rounded-full bg-primary text-primary-content font-bold text-3xl shadow-lg ring-4 ring-base-100">
                    {profile.user.avatar ? (
                      <img src={profile.user.avatar} alt="avatar" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center">{(profile.user.nickname || profile.user.username)[0].toUpperCase()}</span>
                    )}
                  </div>
                </div>

                <div className="mt-1 flex flex-col items-center">
                  {/* Tên hiển thị / Biệt danh */}
                  {isEditingAlias ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        type="text"
                        className="input input-bordered input-sm font-semibold"
                        placeholder="Đặt biệt danh..."
                        value={alias}
                        onChange={e => setAlias(e.target.value)}
                        autoFocus
                      />
                      <button
                        onClick={handleSaveAlias}
                        disabled={aliasLoading}
                        className="btn btn-primary btn-sm text-white"
                      >
                        {aliasLoading ? 'Lưu...' : 'Lưu'}
                      </button>
                      <button
                        onClick={() => { setIsEditingAlias(false); setAlias(profile.customAlias || ''); }}
                        className="btn btn-ghost btn-sm bg-base-200"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xl font-bold tracking-tight">
                        {profile.customAlias || profile.user.nickname || profile.user.username}
                      </h3>
                      {profile.friendshipStatus === 'accepted' && (
                        <button
                          onClick={() => setIsEditingAlias(true)}
                          className="btn btn-circle btn-ghost btn-xs text-base-content/40 hover:text-primary"
                          title="Đặt biệt danh riêng cho bạn bè"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Hiển thị tên thật/gốc nếu có biệt danh riêng */}
                  {profile.customAlias && (
                    <p className="text-xs text-base-content/50 font-medium mt-0.5">
                      Tên thật: <span className="font-semibold text-base-content/70">{profile.user.nickname || profile.user.username}</span> (@{profile.user.username})
                    </p>
                  )}

                  {!profile.customAlias && (
                    <p className="text-xs text-base-content/50 font-medium mt-0.5">
                      @{profile.user.username}
                    </p>
                  )}

                  {profile.user.bio && (
                    <p className="text-xs italic text-base-content/70 bg-base-200/80 px-3.5 py-1.5 rounded-xl border border-base-300 max-w-xs mt-2 leading-relaxed">
                      "{profile.user.bio}"
                    </p>
                  )}

                  <p className="text-xs font-semibold mt-1.5">
                    {profile.user.isOnline ? (
                      <span className="text-success flex items-center justify-center gap-1">
                        ● Đang hoạt động
                      </span>
                    ) : (
                      <span className="text-base-content/40">
                        {profile.user.lastSeen
                          ? `Hoạt động ${formatDistanceToNow(new Date(profile.user.lastSeen), { addSuffix: true, locale: vi })}`
                          : 'Ngoại tuyến'}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex items-center justify-center gap-2 pt-2 border-t border-base-300">
                {profile.friendshipStatus === 'self' && (
                  <div className="text-xs text-base-content/40 bg-base-200 px-4 py-2 rounded-xl font-medium w-full text-center">
                    Đây là trang cá nhân của bạn
                  </div>
                )}

                {profile.friendshipStatus === 'accepted' && (
                  <>
                    <button
                      onClick={handleOpenDM}
                      className="btn btn-primary btn-sm flex-1 text-white gap-1.5"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                      <span>Nhắn tin</span>
                    </button>
                    {onInitiateCall && (
                      <>
                        <button
                          onClick={() => { onInitiateCall(profile.user, 'audio'); onClose(); }}
                          className="btn btn-sm bg-primary/10 hover:bg-primary/20 text-primary border-primary/20"
                          title="Gọi thoại"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => { onInitiateCall(profile.user, 'video'); onClose(); }}
                          className="btn btn-sm btn-success text-white"
                          title="Gọi video"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleUnfriend}
                      disabled={actionLoading}
                      className="btn btn-sm bg-error/10 hover:bg-error/20 text-error border-error/20 gap-1.5"
                      title="Hủy kết bạn"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="18" y1="8" x2="23" y2="13" />
                        <line x1="23" y1="8" x2="18" y2="13" />
                      </svg>
                      <span>Hủy bạn</span>
                    </button>
                  </>
                )}

                {profile.friendshipStatus === 'none' && (
                  <>
                    <button
                      onClick={handleSendRequest}
                      disabled={actionLoading}
                      className="btn btn-primary btn-sm flex-1 text-white gap-1.5"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="17" y1="11" x2="23" y2="11" />
                      </svg>
                      <span>{actionLoading ? 'Đang gửi...' : 'Kết bạn'}</span>
                    </button>
                    <button
                      onClick={handleOpenDM}
                      className="btn btn-sm btn-ghost bg-base-200 gap-1.5"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                      <span>Nhắn tin</span>
                    </button>
                  </>
                )}

                {profile.friendshipStatus === 'pending_sent' && (
                  <button
                    onClick={handleCancelRequest}
                    disabled={actionLoading}
                    className="btn btn-sm flex-1 bg-warning/10 hover:bg-warning/20 text-warning border-warning/30 gap-1.5"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{actionLoading ? 'Đang hủy...' : 'Đã gửi lời mời (Bấm để hủy)'}</span>
                  </button>
                )}

                {profile.friendshipStatus === 'pending_received' && (
                  <>
                    <button
                      onClick={handleAcceptRequest}
                      disabled={actionLoading}
                      className="btn btn-success btn-sm flex-1 text-white gap-1.5"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Chấp nhận lời mời</span>
                    </button>
                    <button
                      onClick={handleRejectRequest}
                      disabled={actionLoading}
                      className="btn btn-sm bg-error/10 hover:bg-error/20 text-error border-error/20"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span>Từ chối</span>
                    </button>
                  </>
                )}
              </div>

              {/* Info Details Section */}
              <div className="bg-base-200/80 border border-base-300 rounded-xl p-4 flex flex-col gap-3">
                <h4 className="text-xs font-bold text-base-content/40 uppercase tracking-wider">Thông tin cá nhân</h4>

                {profile.friendshipStatus === 'accepted' && (
                  <button
                    onClick={() => setShowSafetyNumber(true)}
                    className="btn btn-sm btn-primary w-full text-white rounded-xl justify-between normal-case"
                  >
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" /> Mã an toàn E2EE
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold">
                      Xem &amp; xác minh <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-base-content/50 font-medium">Email:</span>
                  <span className="font-semibold">{profile.user.email || 'Chưa cập nhật'}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-base-content/50 font-medium">Số điện thoại:</span>
                  <span className="font-semibold">{profile.user.phone || 'Chưa cập nhật'}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-base-content/50 font-medium">Giới tính:</span>
                  <span className="font-semibold">
                    {profile.user.gender === 'male' ? 'Nam' : profile.user.gender === 'female' ? 'Nữ' : profile.user.gender === 'other' ? 'Khác' : 'Chưa cập nhật'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-base-content/50 font-medium">Ngày sinh:</span>
                  <span className="font-semibold">
                    {profile.user.dateOfBirth ? format(new Date(profile.user.dateOfBirth), 'dd/MM/yyyy') : 'Chưa cập nhật'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-base-content/50 font-medium">Tham gia từ:</span>
                  <span className="font-semibold">
                    {profile.user.createdAt ? format(new Date(profile.user.createdAt), 'dd/MM/yyyy') : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Mutual Groups Section */}
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-bold text-base-content/40 uppercase tracking-wider flex items-center justify-between">
                  <span>Nhóm chung</span>
                  <span className="badge badge-neutral badge-sm">
                    {profile.mutualRooms?.length || 0}
                  </span>
                </h4>

                {profile.mutualRooms && profile.mutualRooms.length > 0 ? (
                  <ul className="menu menu-sm p-0 gap-1 max-h-36 overflow-y-auto hide-scrollbar flex-nowrap">
                    {profile.mutualRooms.map(room => (
                      <li key={room._id}>
                        <a
                          onClick={() => {
                            if (onSelectRoom) {
                              onSelectRoom(room);
                              onClose();
                            }
                          }}
                          className="group"
                        >
                          <div className="avatar placeholder flex-shrink-0">
                            <div className="w-8 rounded-full bg-primary/10 text-primary font-bold text-xs">
                              {room.avatar ? (
                                <img src={room.avatar} alt="room avatar" />
                              ) : (
                                <span>{(room.name || 'N')[0].toUpperCase()}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate group-hover:text-primary transition-colors">
                              {room.name || 'Nhóm chat'}
                            </p>
                            <p className="text-[10px] text-base-content/40">
                              {room.members?.length || 0} thành viên
                            </p>
                          </div>
                          <span className="text-xs text-base-content/30 group-hover:text-primary transition-colors">➔</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-base-content/40 italic bg-base-200/50 p-3 rounded-xl text-center">
                    Không có nhóm chung nào
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        {showSafetyNumber && profile && (
          <SafetyNumberModal
            user={user}
            contactUser={profile.user}
            onClose={() => setShowSafetyNumber(false)}
            zIndex="z-[60]"
          />
        )}
    </Modal>
  );
}
