import { useState, useEffect } from 'react';
import { Search, Plus } from 'lucide-react';
import Toast from '../common/Toast';
import useTimedMessage from '../../hooks/useTimedMessage';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import api from '../../services/api';
import {
  decryptMessage, getDeviceId, getPrivateKey,
  unwrapSenderKey, decryptWithSenderKey, storeSenderKey, getSenderKey,
} from '../../utils/e2ee';

// Lấy thông tin người đang chat cùng trong phòng DM
const getDMPartner = (room, currentUser) => {
  if (!room?.isDM || !room?.members) return null;
  return room.members.find(m => m._id?.toString() !== currentUser._id?.toString());
};

// Giải mã tin nhắn preview (lastMessage) — tự nhận diện scheme (RSA-per-device cũ/DM, hay Sender
// Key cho nhóm). Trùng lặp có chủ đích với ChatWindow.jsx (Sidebar vốn đã tự giải mã riêng).
const decryptRoomMessage = async (msg, roomId) => {
  const devId = getDeviceId();
  if (msg.scheme !== 'sender-key') {
    return decryptMessage(msg, devId);
  }

  let senderKey = await getSenderKey(roomId, msg.senderDeviceId, msg.epoch);
  if (!senderKey) {
    try {
      const { data: dist } = await api.get(`/rooms/${roomId}/sender-key`, {
        params: { epoch: msg.epoch, senderDeviceId: msg.senderDeviceId },
      });
      const wrapped = dist.encryptedKeys?.[devId];
      if (!wrapped) return '[Không thể giải mã tin nhắn — Thiết bị này chưa được phân phối Sender Key]';
      const privateKey = await getPrivateKey(devId);
      if (!privateKey) return '[Không tìm thấy Private Key trên thiết bị này]';
      senderKey = await unwrapSenderKey(wrapped, privateKey);
      await storeSenderKey(roomId, msg.senderDeviceId, msg.epoch, senderKey);
    } catch (err) {
      console.error('[E2EE] Sender Key fetch error:', err);
      return '[Không thể giải mã tin nhắn — Chưa có Sender Key]';
    }
  }
  return decryptWithSenderKey(msg, senderKey);
};

export default function Sidebar({ activeRoom, onSelectRoom }) {
  const { user }             = useAuth();
  const { on, emit }        = useSocket();
  const [rooms, setRooms]   = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomIsPublic, setNewRoomIsPublic] = useState(false);
  const [newRoomNeedsApproval, setNewRoomNeedsApproval] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [allRooms, setAllRooms] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createError, setCreateError] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'dm' | 'group'
  const [infoMsg, showInfo] = useTimedMessage();

  // Load danh sách phòng của user
  useEffect(() => {
    api.get('/rooms').then(async res => {
      const decryptedRooms = await Promise.all(
        res.data.map(async room => {
          const lastMsg = room.lastMessage;
          if (!lastMsg || lastMsg.isDeleted || (!lastMsg.encryptedKeys && lastMsg.scheme !== 'sender-key')) return room;
          const decryptedText = await decryptRoomMessage(lastMsg, room._id);
          return { ...room, lastMessage: { ...lastMsg, content: decryptedText } };
        })
      );
      setRooms(decryptedRooms);
    });
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

  // Mình vừa rời nhóm hoặc bị kick — bỏ phòng đó khỏi danh sách
  useEffect(() => {
    const off = on('room:removed', ({ roomId }) => {
      setRooms(prev => prev.filter(r => r._id !== roomId));
    });
    return off;
  }, [on]);

  // Người khác rời/bị kick khỏi 1 nhóm mình đang ở — cập nhật danh sách thành viên
  useEffect(() => {
    const off = on('room:member_left', ({ roomId, userId }) => {
      setRooms(prev => prev.map(r => r._id === roomId
        ? { ...r, members: r.members?.filter(m => m._id?.toString() !== userId?.toString()) }
        : r
      ));
    });
    return off;
  }, [on]);

  // Có người mới vào 1 nhóm mình đang ở — cập nhật danh sách thành viên, không thì khi mở
  // ChatWindow của nhóm đó sau (khởi tạo roomMembers từ room prop lấy ở đây) sẽ thiếu người mới
  // cho tới khi tải lại trang.
  useEffect(() => {
    const off = on('room:member_joined', ({ roomId, member }) => {
      setRooms(prev => prev.map(r => r._id === roomId
        ? { ...r, members: r.members?.some(m => m._id === member._id) ? r.members : [...(r.members || []), member] }
        : r
      ));
    });
    return off;
  }, [on]);

  // Cập nhật tin nhắn cuối khi có tin nhắn mới, bị xóa hoặc chỉnh sửa
  useEffect(() => {
    const offNew = on('message:new', async (msg) => {
      const decryptedText = msg.isDeleted ? msg.content : await decryptRoomMessage(msg, msg.room);
      const decryptedMsg = { ...msg, content: decryptedText };
      setRooms(prev =>
        prev.map(r => r._id === msg.room
          ? { ...r, lastMessage: decryptedMsg, updatedAt: msg.createdAt }
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

    const offEdited = on('message:edited', ({ messageId, content, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch, isEdited }) => {
      setRooms(prev => {
        const targetRoom = prev.find(r => r.lastMessage?._id === messageId);
        if (!targetRoom) return prev;
        // roomId chỉ suy ra được từ state hiện có (payload message:edited không kèm roomId) —
        // giải mã xong mới cập nhật state ở lần setRooms thứ 2, lần này giữ nguyên state cũ.
        decryptRoomMessage({ content, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch }, targetRoom._id)
          .then(decryptedText => {
            setRooms(cur => cur.map(r => r.lastMessage?._id === messageId
              ? { ...r, lastMessage: { ...r.lastMessage, content: decryptedText, isEdited, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch } }
              : r
            ));
          });
        return prev;
      });
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
    setCreateError('');
    try {
      const { data } = await api.post('/rooms', {
        name: newRoomName,
        isPrivate: !newRoomIsPublic,
        joinPolicy: newRoomIsPublic && newRoomNeedsApproval ? 'approval' : 'open',
      });
      setRooms(prev => prev.find(r => r._id === data._id) ? prev : [data, ...prev]);
      setNewRoomName('');
      setNewRoomIsPublic(false);
      setNewRoomNeedsApproval(false);
      setShowCreate(false);
      onSelectRoom(data);
      emit('room:join', data._id);
    } catch (err) {
      setCreateError(err.response?.data?.message || 'Tạo phòng thất bại');
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
      if (data.status === 'pending') {
        setShowJoin(false);
        showInfo('Đã gửi yêu cầu tham gia, chờ quản trị viên duyệt');
        return;
      }
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
    <div className="flex flex-col h-full bg-base-100 text-base-content font-sans select-none">
      <Toast message={infoMsg} type="success" />
      {/* Header Chats */}
      <div className="p-4 pb-2 flex flex-col gap-3 flex-shrink-0">
        {/* Tabs lọc theo loại cuộc trò chuyện */}
        <div role="tablist" className="tabs tabs-boxed bg-base-200 w-fit">
          <a role="tab" className={`tab ${filterType === 'all' ? 'tab-active' : ''}`} onClick={() => setFilterType('all')}>Tất cả</a>
          <a role="tab" className={`tab ${filterType === 'dm' ? 'tab-active' : ''}`} onClick={() => setFilterType('dm')}>Riêng tư</a>
          <a role="tab" className={`tab ${filterType === 'group' ? 'tab-active' : ''}`} onClick={() => setFilterType('group')}>Nhóm</a>
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tight">Đoạn chat</h1>

          <div className="flex gap-2">
            <button
              onClick={handleShowJoin}
              className="btn btn-circle btn-ghost btn-sm bg-base-200"
              title="Tìm phòng chat công khai"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="btn btn-circle btn-ghost btn-sm bg-base-200"
              title="Tạo phòng chat mới"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Ô Tìm kiếm */}
        <label className="input input-bordered rounded-full flex items-center gap-2 bg-base-200 border-none text-xs">
          <Search className="w-3.5 h-3.5 opacity-50" />
          <input
            className="grow"
            placeholder="Tìm kiếm cuộc trò chuyện"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      {/* Vùng cuộn danh sách phòng & bạn bè */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-3 py-1 flex flex-col gap-1">

        {/* Form tạo phòng */}
        {showCreate && (
          <div className="mb-2 bg-base-200/50 rounded-xl p-2.5 flex flex-col gap-2">
            <form onSubmit={createRoom} className="join w-full">
              <input
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                placeholder="Tên phòng mới..."
                className="input input-bordered input-sm join-item w-full bg-base-100"
                autoFocus
              />
              <button type="submit" className="btn btn-primary btn-sm join-item text-white">Tạo</button>
            </form>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="checkbox checkbox-xs" checked={newRoomIsPublic} onChange={e => setNewRoomIsPublic(e.target.checked)} />
              Phòng công khai (ai cũng tìm thấy ở mục tìm kiếm)
            </label>
            {newRoomIsPublic && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-xs" checked={newRoomNeedsApproval} onChange={e => setNewRoomNeedsApproval(e.target.checked)} />
                Cần duyệt khi có người xin vào
              </label>
            )}
            {createError && <p className="text-error text-[11px]">{createError}</p>}
          </div>
        )}

        {/* Danh sách phòng để tham gia */}
        {showJoin && (
          <div className="bg-base-100 rounded-xl p-3 mb-2 border border-base-300 flex flex-col gap-2 shadow-lg">
            <div className="flex items-center justify-between text-xs font-bold pb-1.5 border-b border-base-300">
              <span>Tìm và tham gia phòng</span>
              <button onClick={() => setShowJoin(false)} className="btn btn-xs btn-circle btn-ghost">✕</button>
            </div>

            <ul className="menu menu-sm max-h-40 overflow-y-auto hide-scrollbar p-0 flex-nowrap">
              {allRooms.length === 0 && (
                <p className="text-[11px] text-center text-base-content/50 py-3 italic">Không có phòng công khai</p>
              )}
              {allRooms.filter(r => !r.isDM).map(room => {
                const isMember = rooms.find(r => r._id === room._id);
                return (
                  <li key={room._id}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold truncate max-w-[150px]"># {room.name}</span>
                      {isMember ? (
                        <span className="text-base-content/40 italic">Đã vào</span>
                      ) : (
                        <button onClick={() => joinRoom(room)} className="btn btn-primary btn-xs rounded-full text-white">Vào</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Danh sách phòng của user */}
        <h2 className="text-xs font-bold text-base-content/40 uppercase tracking-wider px-3 pt-1 pb-1">Gần đây</h2>
        <ul className="menu menu-lg p-0 gap-1 flex-nowrap">
          {rooms.length === 0 && (
            <p className="text-xs text-center text-base-content/50 py-8 px-3 italic">
              Chưa có cuộc trò chuyện nào. Hãy tạo phòng mới!
            </p>
          )}
          {rooms
            .filter(room => {
              if (filterType === 'dm' && !room.isDM) return false;
              if (filterType === 'group' && room.isDM) return false;
              const dmPartner = getDMPartner(room, user);
              const displayName = room.isDM
                ? (dmPartner?.nickname || 'Người dùng')
                : room.name;
              return displayName.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .map(room => {
            const dmPartner = getDMPartner(room, user);
            const displayName = room.isDM
              ? (dmPartner?.nickname || 'Người dùng')
              : room.name;

            const isActive = activeRoom?._id === room._id;
            const lastMsg = room.lastMessage;

            return (
              <li key={room._id}>
                <a
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${isActive ? 'active font-semibold' : ''}`}
                  onClick={() => onSelectRoom(room)}
                >
                  {/* Avatar / Icon phòng */}
                  {room.isDM ? (
                    <div className={`avatar ${dmPartner?.isOnline ? 'avatar-online' : 'avatar-offline'} flex-shrink-0`}>
                      <div className="w-11 rounded-full ring-1 ring-base-300">
                        {dmPartner?.avatar ? (
                          <img src={dmPartner.avatar} alt="avatar" />
                        ) : (
                          <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold text-base">
                            {displayName[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-primary to-secondary text-primary-content flex items-center justify-center font-bold text-base flex-shrink-0">
                      💬
                    </div>
                  )}

                  {/* Tên phòng & Tin nhắn xem trước */}
                  <div className="flex-1 min-w-0 flex flex-col leading-tight">
                    <span className="text-[14px] font-semibold truncate">{displayName}</span>
                    <span className="text-xs text-base-content/60 truncate mt-0.5">
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
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
