import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { formatDistanceToNow, format } from 'date-fns';
import { vi } from 'date-fns/locale';

export default function OtherUserProfileModal({ userId, onClose, onSelectRoom, onInitiateCall }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const { on } = useSocket();

  const [alias, setAlias] = useState('');
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [aliasLoading, setAliasLoading] = useState(false);

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
      alert(err.response?.data?.message || 'Không thể lưu biệt danh');
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

    const offStatus = on('user_status_changed', ({ userId: socketUserId, isOnline, lastSeen }) => {
      if (socketUserId === profile.user._id) {
        setProfile(prev => prev ? {
          ...prev,
          user: {
            ...prev.user,
            isOnline,
            lastSeen: lastSeen || new Date(),
          }
        } : null);
      }
    });

    return () => {
      if (offStatus) offStatus();
    };
  }, [profile?.user?._id, on]);

  // ── Xử lý các nút hành động ──
  
  // Gửi lời mời kết bạn
  const handleSendRequest = async () => {
    setActionLoading(true);
    try {
      await api.post(`/friends/request/${userId}`);
      setProfile(prev => ({ ...prev, friendshipStatus: 'pending_sent' }));
    } catch (err) {
      alert(err.response?.data?.message || 'Gửi lời mời thất bại');
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
    } catch (err) {
      alert(err.response?.data?.message || 'Hủy lời mời thất bại');
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
    } catch (err) {
      alert(err.response?.data?.message || 'Chấp nhận thất bại');
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
    } catch (err) {
      alert(err.response?.data?.message || 'Từ chối thất bại');
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
    } catch (err) {
      alert(err.response?.data?.message || 'Hủy kết bạn thất bại');
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
      alert('Chưa thể mở đoạn chat hoặc chưa có phòng chat riêng.');
    }
  };

  if (!userId) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="card w-full max-w-md bg-white text-black border border-gray-200 relative overflow-hidden shadow-2xl rounded-2xl font-sans"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-base font-bold text-gray-800">Trang cá nhân</h2>
          <button 
            className="hover:bg-gray-200/80 text-gray-500 hover:text-black text-xs cursor-pointer bg-gray-100 px-3 py-1.5 rounded-full font-semibold transition-colors"
            onClick={onClose}
          >
            ✕ Đóng
          </button>
        </div>

        {/* Nội dung Modal */}
        <div className="overflow-y-auto max-h-[80vh] p-6 hide-scrollbar flex flex-col gap-6 bg-white">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-400">
              <span className="animate-spin text-2xl">⏳</span>
              <span className="text-sm font-medium">Đang tải thông tin...</span>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-red-500 text-sm font-semibold">
              ⚠️ {error}
            </div>
          ) : profile ? (
            <>
              {/* Profile Hero Section */}
              <div className="flex flex-col items-center text-center gap-2">
                {/* Cover Banner */}
                <div className="relative w-full h-32 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 overflow-hidden shadow-xs">
                  {profile.user.cover ? (
                    <img src={profile.user.cover} alt="cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-r from-blue-500 to-indigo-600 opacity-90 flex items-center justify-center text-white/30 text-xs font-semibold">
                      Chưa có ảnh bìa
                    </div>
                  )}
                </div>

                {/* Avatar with overlap */}
                <div className="relative -mt-12">
                  <div className="w-24 h-24 rounded-full bg-[#0084ff] text-white flex items-center justify-center font-bold text-3xl shadow-lg ring-4 ring-white overflow-hidden">
                    {profile.user.avatar ? (
                      <img src={profile.user.avatar} alt="avatar" className="object-cover w-full h-full" />
                    ) : (
                      <span>{(profile.user.nickname || profile.user.username)[0].toUpperCase()}</span>
                    )}
                  </div>
                  {/* Status Indicator */}
                  <div 
                    className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-white ${
                      profile.user.isOnline ? 'bg-green-500 ring-2 ring-green-100' : 'bg-gray-400'
                    }`}
                    title={profile.user.isOnline ? 'Đang hoạt động' : 'Ngoại tuyến'}
                  />
                </div>

                <div className="mt-1 flex flex-col items-center">
                  {/* Tên hiển thị / Biệt danh */}
                  {isEditingAlias ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        type="text"
                        className="bg-white border border-gray-300 rounded-lg px-2.5 py-1 text-sm font-semibold text-gray-800 outline-none focus:border-[#0084ff]"
                        placeholder="Đặt biệt danh..."
                        value={alias}
                        onChange={e => setAlias(e.target.value)}
                        autoFocus
                      />
                      <button
                        onClick={handleSaveAlias}
                        disabled={aliasLoading}
                        className="bg-[#0084ff] hover:bg-[#0073de] text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer"
                      >
                        {aliasLoading ? 'Lưu...' : 'Lưu'}
                      </button>
                      <button
                        onClick={() => { setIsEditingAlias(false); setAlias(profile.customAlias || ''); }}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold px-2 py-1.5 rounded-lg transition-all cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xl font-bold text-gray-900 tracking-tight">
                        {profile.customAlias || profile.user.nickname || profile.user.username}
                      </h3>
                      {profile.friendshipStatus === 'accepted' && (
                        <button
                          onClick={() => setIsEditingAlias(true)}
                          className="text-gray-400 hover:text-[#0084ff] p-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer flex items-center justify-center"
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
                    <p className="text-xs text-gray-500 font-medium mt-0.5">
                      Tên thật: <span className="font-semibold text-gray-700">{profile.user.nickname || profile.user.username}</span> (@{profile.user.username})
                    </p>
                  )}

                  {!profile.customAlias && (
                    <p className="text-xs text-gray-500 font-medium mt-0.5">
                      @{profile.user.username}
                    </p>
                  )}

                  {profile.user.bio && (
                    <p className="text-xs italic text-gray-600 bg-gray-50/80 px-3.5 py-1.5 rounded-xl border border-gray-100 max-w-xs mt-2 leading-relaxed">
                      "{profile.user.bio}"
                    </p>
                  )}

                  <p className="text-xs font-semibold mt-1.5">
                    {profile.user.isOnline ? (
                      <span className="text-green-600 flex items-center justify-center gap-1">
                        ● Đang hoạt động
                      </span>
                    ) : (
                      <span className="text-gray-400">
                        {profile.user.lastSeen 
                          ? `Hoạt động ${formatDistanceToNow(new Date(profile.user.lastSeen), { addSuffix: true, locale: vi })}` 
                          : 'Ngoại tuyến'}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-100">
                {profile.friendshipStatus === 'self' && (
                  <div className="text-xs text-gray-400 bg-gray-50 px-4 py-2 rounded-xl font-medium w-full text-center">
                    Đây là trang cá nhân của bạn
                  </div>
                )}

                {profile.friendshipStatus === 'accepted' && (
                  <>
                    <button 
                      onClick={handleOpenDM}
                      className="flex-1 bg-[#0084ff] hover:bg-[#0073de] text-white font-bold text-xs py-2.5 px-3 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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
                          className="bg-blue-50 hover:bg-blue-100 text-[#0084ff] font-bold text-xs py-2.5 px-3 rounded-xl transition-all border border-blue-100 flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                          title="Gọi thoại"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => { onInitiateCall(profile.user, 'video'); onClose(); }}
                          className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2.5 px-3 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95"
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
                      className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs py-2.5 px-3 rounded-xl transition-all border border-red-100 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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
                      className="flex-1 bg-[#0084ff] hover:bg-[#0073de] text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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
                    className="flex-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
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
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Chấp nhận lời mời</span>
                    </button>
                    <button 
                      onClick={handleRejectRequest}
                      disabled={actionLoading}
                      className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs py-2.5 px-3 rounded-xl transition-all border border-red-100 flex items-center justify-center gap-1 cursor-pointer active:scale-95"
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
              <div className="bg-gray-50/80 border border-gray-100 rounded-xl p-4 flex flex-col gap-3">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Thông tin cá nhân</h4>
                
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Email:</span>
                  <span className="font-semibold text-gray-800">{profile.user.email || 'Chưa cập nhật'}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Số điện thoại:</span>
                  <span className="font-semibold text-gray-800">{profile.user.phone || 'Chưa cập nhật'}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Giới tính:</span>
                  <span className="font-semibold text-gray-800">
                    {profile.user.gender === 'male' ? 'Nam' : profile.user.gender === 'female' ? 'Nữ' : profile.user.gender === 'other' ? 'Khác' : 'Chưa cập nhật'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Ngày sinh:</span>
                  <span className="font-semibold text-gray-800">
                    {profile.user.dateOfBirth ? format(new Date(profile.user.dateOfBirth), 'dd/MM/yyyy') : 'Chưa cập nhật'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Tham gia từ:</span>
                  <span className="font-semibold text-gray-800">
                    {profile.user.createdAt ? format(new Date(profile.user.createdAt), 'dd/MM/yyyy') : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Mutual Groups Section */}
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Nhóm chung</span>
                  <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-bold">
                    {profile.mutualRooms?.length || 0}
                  </span>
                </h4>

                {profile.mutualRooms && profile.mutualRooms.length > 0 ? (
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto hide-scrollbar">
                    {profile.mutualRooms.map(room => (
                      <div 
                        key={room._id}
                        onClick={() => {
                          if (onSelectRoom) {
                            onSelectRoom(room);
                            onClose();
                          }
                        }}
                        className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all cursor-pointer group"
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-[#0084ff] font-bold text-xs flex items-center justify-center flex-shrink-0">
                          {room.avatar ? (
                            <img src={room.avatar} alt="room avatar" className="w-full h-full object-cover rounded-full" />
                          ) : (
                            (room.name || 'N')[0].toUpperCase()
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate group-hover:text-[#0084ff] transition-colors">
                            {room.name || 'Nhóm chat'}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {room.members?.length || 0} thành viên
                          </p>
                        </div>
                        <span className="text-xs text-gray-300 group-hover:text-[#0084ff] transition-colors">➔</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic bg-gray-50/50 p-3 rounded-xl text-center">
                    Không có nhóm chung nào
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
