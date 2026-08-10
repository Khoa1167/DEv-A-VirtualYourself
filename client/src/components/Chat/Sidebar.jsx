import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import api from '../../services/api';
import { decryptMessage, getDeviceId } from '../../utils/e2ee';
import ProfileModal from '../Profile/ProfileModal';
import KeyBackupModal from '../Settings/KeyBackupModal';

// Lấy thông tin người đang chat cùng trong phòng DM
const getDMPartner = (room, currentUser) => {
  if (!room?.isDM || !room?.members) return null;
  return room.members.find(m => m._id?.toString() !== currentUser._id?.toString());
};

export default function Sidebar({ activeRoom, onSelectRoom }) {
  const { user, logout }    = useAuth();
  const { on, emit }        = useSocket();
  const [rooms, setRooms]   = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [allRooms, setAllRooms] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [showKeyBackup, setShowKeyBackup] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load danh sách phòng của user
  useEffect(() => {
    api.get('/rooms').then(res => setRooms(res.data));
  }, []);

  // Lắng nghe khi được thêm vào phòng mới
  useEffect(() => {
    const off = on('room:added', (room) => {
      setRooms(prev => {
        const exists = prev.find(r => r._id === room._id);
        if (exists) return prev;
        return [room, ...prev];
      });
    });
    return off;
  }, [on]);

    // Cập nhật trạng thái online
  useEffect(() => {
    const off = on('user:online', ({ userId }) => {
      setRooms(prev => prev.map(r => ({
        ...r,
        members: r.members?.map(m =>
          m._id?.toString() === userId?.toString()
            ? { ...m, isOnline: true }
            : m
        )
      })));
    });
    return off;
  }, [on]);

  // Cập nhật trạng thái offline
  useEffect(() => {
    const off = on('user:offline', ({ userId }) => {
      setRooms(prev => prev.map(r => ({
        ...r,
        members: r.members?.map(m =>
          m._id?.toString() === userId?.toString()
            ? { ...m, isOnline: false }
            : m
        )
      })));
    });
    return off;
  }, [on]);

  // Cập nhật tin nhắn cuối khi có tin nhắn mới, bị xóa hoặc chỉnh sửa
  useEffect(() => {
    const offNew = on('message:new', (msg) => {
      setRooms(prev =>
        prev.map(r => r._id === msg.room
          ? { ...r, lastMessage: msg, updatedAt: msg.createdAt }
          : r
        ).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      );
    });

    const offDeleted = on('message:deleted', ({ messageId }) => {
      setRooms(prev =>
        prev.map(r => r.lastMessage?._id === messageId
          ? { ...r, lastMessage: { ...r.lastMessage, isDeleted: true } }
          : r
        )
      );
    });

    const offEdited = on('message:edited', async ({ messageId, content, iv, tag, encryptedKeys, isEdited }) => {
      const devId = getDeviceId();
      const decryptedText = await decryptMessage({ content, iv, tag, encryptedKeys }, devId);
      setRooms(prev =>
        prev.map(r => r.lastMessage?._id === messageId
          ? { ...r, lastMessage: { ...r.lastMessage, content: decryptedText, isEdited, iv, tag, encryptedKeys } }
          : r
        )
      );
    });

    return () => {
      offNew();
      offDeleted();
      offEdited();
    };
  }, [on]);

  // Tạo phòng mới
  const createRoom = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      const { data } = await api.post('/rooms', { name: newRoomName });
      setRooms(prev => [data, ...prev]);
      setNewRoomName('');
      setShowCreate(false);
      onSelectRoom(data);
      emit('room:join', data._id);
    } catch (err) {
      alert(err.response?.data?.message || 'Tạo phòng thất bại');
    }
  };

  // Hiển thị danh sách tất cả phòng để tham gia
  const handleShowJoin = async () => {
    try {
      const { data } = await api.get('/rooms/all');
      setAllRooms(data);
      setShowJoin(true);
    } catch (err) {
      console.error(err);
    }
  };

  // Tham gia phòng
  const joinRoom = async (room) => {
    try {
      const { data } = await api.post(`/rooms/${room._id}/join`);
      setRooms(prev => {
        const exists = prev.find(r => r._id === data._id);
        if (exists) return prev;
        return [data, ...prev];
      });
      setShowJoin(false);
      onSelectRoom(data);
      emit('room:join', data._id);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-black font-sans select-none">
      {/* Header Chats kiểu Messenger */}
      <div className="p-4 pb-2 flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Avatar của User để mở Cài đặt cá nhân */}
            <div 
              className="w-9 h-9 rounded-full bg-gray-200 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden ring-1 ring-gray-200"
              onClick={() => setShowProfile(true)}
              title="Cài đặt cá nhân"
            >
              {user.avatar ? (
                <img src={user.avatar} alt="avatar" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#0084ff] text-white font-bold text-sm">
                  {(user.nickname || user.username)[0].toUpperCase()}
                </div>
              )}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900">Đoạn chat</h1>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={handleShowJoin} 
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer transition-colors text-gray-600"
              title="Tìm phòng chat công khai"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.604 10.604z" />
              </svg>
            </button>
            <button 
              onClick={() => setShowCreate(!showCreate)} 
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer transition-colors text-base font-bold text-gray-700"
              title="Tạo phòng chat mới"
            >
              +
            </button>
            <button 
              onClick={() => setShowKeyBackup(true)} 
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer transition-colors text-base"
              title="Sao lưu & Khôi phục Khóa E2EE"
            >
              🔑
            </button>
            <button 
              onClick={logout} 
              className="w-8 h-8 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center cursor-pointer transition-colors text-red-500"
              title="Đăng xuất"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M19.5 8.25l3.75 3.75m0 0l-3.75 3.75m3.75-3.75H12" />
              </svg>
            </button>
          </div>
        </div>

        {showKeyBackup && (
          <KeyBackupModal onClose={() => setShowKeyBackup(false)} />
        )}

        {/* Ô Tìm kiếm bo tròn Messenger */}
        <div className="relative">
          <input 
            className="w-full bg-[#f0f2f5] border-none rounded-full py-2 pl-9 pr-4 text-xs text-black placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
            placeholder="Tìm kiếm trên Messenger"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.604 10.604z" />
            </svg>
          </span>
        </div>
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

      {/* Vùng cuộn danh sách phòng & bạn bè */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-3 py-1 flex flex-col gap-1">
        
        {/* Nút Bạn bè & Lời mời kết bạn */}
        <div
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 mb-1.5 ${
            !activeRoom 
              ? 'bg-[#eaf4ff] text-[#0084ff] font-semibold shadow-xs' 
              : 'hover:bg-gray-100 text-black'
          }`}
          onClick={() => onSelectRoom(null)}
        >
          <div className="w-9 h-9 rounded-full bg-[#0084ff]/10 text-[#0084ff] flex items-center justify-center font-bold text-sm">
            👥
          </div>
          <div className="flex flex-col leading-tight flex-1">
            <span className="text-sm font-semibold">Bạn bè & Lời mời</span>
            <span className="text-[10px] opacity-75">Quản lý kết bạn</span>
          </div>
        </div>

        <div className="w-full h-[1px] bg-gray-100 my-1" />

        {/* Form tạo phòng */}
        {showCreate && (
          <form onSubmit={createRoom} className="flex gap-2 p-2 bg-[#f0f2f5] rounded-xl mb-2">
            <input
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              placeholder="Tên phòng mới..."
              className="bg-transparent text-sm placeholder-gray-500 outline-none w-full flex-1 px-1"
              autoFocus
            />
            <button type="submit" className="text-white text-xs font-semibold bg-[#0084ff] px-3 py-1 rounded-full hover:bg-[#0073de] transition-colors">Tạo</button>
          </form>
        )}

        {/* Danh sách phòng để tham gia */}
        {showJoin && (
          <div className="bg-white rounded-xl p-3 mb-2 border border-gray-200 flex flex-col gap-2 shadow-lg">
            <div className="flex items-center justify-between text-xs font-bold text-gray-800 pb-1.5 border-b border-gray-100">
              <span>Tìm và tham gia phòng</span>
              <button onClick={() => setShowJoin(false)} className="hover:text-black text-xs">✕</button>
            </div>
            
            <div className="max-h-40 overflow-y-auto hide-scrollbar flex flex-col gap-1">
              {allRooms.length === 0 && (
                <p className="text-[11px] text-center text-gray-400 py-3 italic">Không có phòng công khai</p>
              )}
              {allRooms.filter(r => !r.isDM).map(room => {
                const isMember = rooms.find(r => r._id === room._id);
                return (
                  <div key={room._id} className="flex items-center justify-between p-1.5 rounded-lg hover:bg-gray-50 text-[11px]">
                    <span className="font-semibold text-gray-700 truncate max-w-[150px]"># {room.name}</span>
                    {isMember ? (
                      <span className="text-gray-400 italic">Đã vào</span>
                    ) : (
                      <button onClick={() => joinRoom(room)} className="bg-[#0084ff] text-white font-bold px-2 py-0.5 rounded-full hover:bg-[#0073de] transition-colors text-[10px]">Vào</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Danh sách phòng của user */}
        <div className="flex flex-col gap-1">
          {rooms.length === 0 && (
            <p className="text-xs text-center text-gray-400 py-8 px-3 italic">
              Chưa có cuộc trò chuyện nào. Hãy tạo phòng mới!
            </p>
          )}
          {rooms
            .filter(room => {
              const dmPartner = getDMPartner(room, user);
              const displayName = room.isDM
                ? (dmPartner?.nickname || 'Người dùng Messenger')
                : room.name;
              return displayName.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .map(room => {
            const dmPartner = getDMPartner(room, user);
            const displayName = room.isDM
              ? (dmPartner?.nickname || 'Người dùng Messenger')
              : room.name;

            const isActive = activeRoom?._id === room._id;
            const lastMsg = room.lastMessage;

            return (
              <div
                key={room._id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-100 ${
                  isActive 
                    ? 'bg-[#f0f2f5] font-semibold' 
                    : 'hover:bg-[#f0f2f5]/60 text-gray-900'
                }`}
                onClick={() => onSelectRoom(room)}
              >
                {/* Avatar / Icon phòng */}
                <div className="relative flex-shrink-0">
                  {room.isDM ? (
                    <div className="w-11 h-11 rounded-full bg-gray-200 text-white flex items-center justify-center font-bold text-base overflow-hidden ring-1 ring-gray-100">
                      {dmPartner?.avatar ? (
                        <img src={dmPartner.avatar} alt="avatar" className="w-11 h-11 rounded-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[#0084ff] flex items-center justify-center text-white">
                          {displayName[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-[#006aff] to-[#00b2ff] text-white flex items-center justify-center font-bold text-base">
                      💬
                    </div>
                  )}
                  {room.isDM && (
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                      dmPartner?.isOnline ? 'bg-[#31a24c]' : 'bg-gray-400'
                    }`} />
                  )}
                </div>
                
                {/* Tên phòng & Tin nhắn xem trước */}
                <div className="flex-1 min-w-0 flex flex-col leading-tight">
                  <span className="text-[14px] font-semibold text-gray-900 truncate">{displayName}</span>
                  <span className="text-xs text-gray-500 truncate mt-0.5">
                    {lastMsg ? (
                      <>
                        <span className="font-medium mr-1">
                          {lastMsg.sender?._id?.toString() === user._id?.toString() ? 'Bạn:' : `${lastMsg.sender?.nickname || lastMsg.sender?.username}:`}
                        </span>
                        {lastMsg.isDeleted ? 'Tin nhắn đã bị thu hồi' : (
                          lastMsg.type === 'image' ? '[Hình ảnh]' :
                          lastMsg.type === 'audio' ? '[Tin nhắn thoại]' :
                          lastMsg.type === 'file' ? `[Tệp: ${lastMsg.fileName || 'Tài liệu'}]` :
                          lastMsg.content
                        )}
                      </>
                    ) : (
                      'Chưa có tin nhắn nào'
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
