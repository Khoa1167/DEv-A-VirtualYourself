import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Phone, Video, Info, ChevronDown, RotateCw, LogOut, UserX, Crown, Shield, ShieldOff, Link2, UserPlus, Check, X, Copy, Pencil } from 'lucide-react';
import QRCode from 'qrcode';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import Toast from '../common/Toast';
import Modal from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import MessageItem from './MessageItem';
import MessageInput from './MessageInput';
import ForwardModal from './ForwardModal';
import api from '../../services/api';
import {
  encryptMessageForRoom, decryptMessage, getDeviceId, getPrivateKey,
  generateSenderKey, wrapSenderKeyForDevices, unwrapSenderKey,
  encryptWithSenderKey, decryptWithSenderKey, storeSenderKey, getSenderKey,
} from '../../utils/e2ee';
import useTimedMessage from '../../hooks/useTimedMessage';

// Lấy thông tin người đang chat cùng trong phòng DM
const getDMPartner = (room, currentUser) => {
  if (!room?.isDM || !room?.members) return null;
  return room.members.find(m => m._id?.toString() !== currentUser._id?.toString());
};

export default function ChatWindow({ room, onBackToFriends, onInitiateCall, onViewProfile }) {
  const { user }          = useAuth();
  const { emit, on, isConnected } = useSocket();
  const [messages, setMessages]       = useState([]);
  const [typing, setTyping]           = useState([]);
  const [replyTo, setReplyTo]         = useState(null);
  const [hasMore, setHasMore]         = useState(true);
  const [dmPartnerOnline, setDmPartnerOnline] = useState(
    () => getDMPartner(room, user)?.isOnline || false
  );
  // Epoch Sender Key hiện hành của phòng nhóm — khởi tạo từ prop, cập nhật realtime qua
  // 'sender_key:rotated' hoặc khi chính mình bấm "Xoay khóa" (room prop là snapshot, không tự đổi)
  const [currentEpoch, setCurrentEpoch] = useState(room?.senderKeyEpoch || 0);
  // Danh sách thành viên/admin/chủ phòng — khởi tạo từ prop, cập nhật realtime qua
  // 'room:member_left'/'room:updated' (room prop là snapshot, không tự đổi khi người khác
  // rời/bị kick/được phong admin trong lúc mình đang mở đúng phòng này)
  const [roomMembers, setRoomMembers] = useState(room?.members || []);
  const [admins, setAdmins] = useState((room?.admins || []).map(a => (a?._id || a)?.toString()));
  const [ownerId, setOwnerId] = useState((room?.createdBy?._id || room?.createdBy)?.toString());
  // Tên/công khai-riêng tư — khởi tạo từ prop, cập nhật realtime qua 'room:settings_updated'
  const [roomName, setRoomName] = useState(room?.name);
  const [roomIsPrivate, setRoomIsPrivate] = useState(room?.isPrivate);
  const [roomJoinPolicy, setRoomJoinPolicy] = useState(room?.joinPolicy);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsNameInput, setSettingsNameInput] = useState('');
  const [settingsPrivateInput, setSettingsPrivateInput] = useState(false);
  const [settingsApprovalInput, setSettingsApprovalInput] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [inviteCode, setInviteCode] = useState(room?.inviteCode);
  const [inviteCodeExpiresAt, setInviteCodeExpiresAt] = useState(room?.inviteCodeExpiresAt);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteQrDataUrl, setInviteQrDataUrl] = useState('');
  // Danh sách bạn bè để "Thêm thành viên" trực tiếp (chỉ admin/chủ phòng thấy) + những người
  // vừa bấm Thêm trong phiên mở modal này (server đã lưu pendingInvites, chỉ cần disable nút)
  const [friendsToAdd, setFriendsToAdd] = useState([]);
  const [addedMemberIds, setAddedMemberIds] = useState([]);
  const [showJoinRequests, setShowJoinRequests] = useState(false);
  const [joinRequests, setJoinRequests] = useState([]);
  const [inviteCopied, setInviteCopied] = useState(false);
  // Modal xác nhận rời nhóm/kick/chuyển chủ phòng — null | { type: 'leave' } |
  // { type: 'kick'|'transfer', memberId, memberName }
  const [confirmAction, setConfirmAction] = useState(null);
  // Popup riêng khi CHỦ PHÒNG bấm rời nhóm — cho chọn người kế nhiệm trước, khác modal
  // confirmAction chung (không đủ chỗ cho danh sách chọn thành viên)
  const [showLeaveOwnerModal, setShowLeaveOwnerModal] = useState(false);
  const [leaveNewOwnerId, setLeaveNewOwnerId] = useState('');
  const [forwardTargetMessage, setForwardTargetMessage] = useState(null);
  const [showForward, setShowForward] = useState(false);
  const [errorMsg, showError] = useTimedMessage();
  const bottomRef = useRef(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const containerRef = useRef(null);
  // Tin nhắn tự hủy — id đã hẹn giờ ẩn rồi, tránh đặt setTimeout trùng mỗi lần messages đổi
  const scheduledExpiryRef = useRef(new Set());

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isFar = scrollHeight - scrollTop - clientHeight > 300;
    setShowScrollBottom(isFar);
  };

  // Giải mã 1 tin nhắn — tự nhận diện scheme (RSA-per-device cũ/DM, hay Sender Key cho nhóm)
  const decryptIncomingMessage = async (msg) => {
    const devId = getDeviceId();
    if (msg.scheme !== 'sender-key') {
      return decryptMessage(msg, devId);
    }

    let senderKey = await getSenderKey(room._id, msg.senderDeviceId, msg.epoch);
    if (!senderKey) {
      try {
        const { data: dist } = await api.get(`/rooms/${room._id}/sender-key`, {
          params: { epoch: msg.epoch, senderDeviceId: msg.senderDeviceId },
        });
        const wrapped = dist.encryptedKeys?.[devId];
        if (!wrapped) return '[Không thể giải mã tin nhắn — Thiết bị này chưa được phân phối Sender Key]';
        const privateKey = await getPrivateKey(devId);
        if (!privateKey) return '[Không tìm thấy Private Key trên thiết bị này]';
        senderKey = await unwrapSenderKey(wrapped, privateKey);
        await storeSenderKey(room._id, msg.senderDeviceId, msg.epoch, senderKey);
      } catch (err) {
        console.error('[E2EE] Sender Key fetch error:', err);
        return '[Không thể giải mã tin nhắn — Chưa có Sender Key]';
      }
    }
    return decryptWithSenderKey(msg, senderKey);
  };

  // Decrypt tin nhắn helper
  const processDecryption = async (rawMessages) => {
    const decrypted = await Promise.all(
      rawMessages.map(async (m) => {
        if (m.isDeleted) return m;
        const text = await decryptIncomingMessage(m);
        return { ...m, decryptedText: text, content: text };
      })
    );
    return decrypted;
  };

  const fetchRoomDevicePublicKeys = async (roomToUse) => {
    if (!roomToUse?.members?.length) return [];

    try {
      const userIds = roomToUse.members.map(m => m._id);
      const { data: devices } = await api.post('/users/devices/batch', { userIds });
      return Array.isArray(devices) ? devices : [];
    } catch (err) {
      console.warn('Lỗi khi lấy public key thiết bị của phòng:', err);
      return [];
    }
  };

  // Load tin nhắn khi chọn phòng mới
  useEffect(() => {
    if (!room) return;

    api.get(`/rooms/${room._id}/messages?limit=30`)
      .then(async res => {
        const decrypted = await processDecryption(res.data);
        setMessages(decrypted);
        setHasMore(res.data.length === 30);
        setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
      });
  }, [room]);

  // Tin nhắn tự hủy — tự ẩn khỏi danh sách đúng lúc hết hạn, không cần F5 (MongoDB TTL index
  // chỉ lo dọn dữ liệu vật lý phía server, việc ẩn ngay trên UI phải tự lo ở client).
  useEffect(() => {
    const timers = [];
    messages.forEach(m => {
      if (!m.expiresAt || scheduledExpiryRef.current.has(m._id)) return;
      scheduledExpiryRef.current.add(m._id);
      const msUntilExpiry = new Date(m.expiresAt).getTime() - Date.now();
      const hide = () => setMessages(prev => prev.filter(x => x._id !== m._id));
      if (msUntilExpiry <= 0) { hide(); return; }
      timers.push(setTimeout(hide, msUntilExpiry));
    });
    return () => timers.forEach(clearTimeout);
  }, [messages]);

  // Lắng nghe các sự kiện WebSocket
  useEffect(() => {
    if (!room) return;

    emit('room:join', room._id);

    // Nhận tin nhắn mới — chỉ tự cuộn xuống khi chính mình là người gửi (vừa bấm gửi), để không
    // kéo người đang cuộn lên đọc lịch sử bị giật xuống mỗi khi người khác nhắn.
    const offNew = on('message:new', async (msg) => {
      if (msg.room?.toString() === room._id?.toString()) {
        const decryptedText = await decryptIncomingMessage(msg);
        const processedMsg = { ...msg, decryptedText, content: decryptedText };
        setMessages(prev => [...prev, processedMsg]);
        if (msg.sender?._id?.toString() === user._id?.toString()) {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });

    // Tin nhắn bị xóa
    const offDeleted = on('message:deleted', ({ messageId }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, isDeleted: true } : m)
      );
    });

    // Tin nhắn được react
    const offReacted = on('message:reacted', ({ messageId, reactions }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, reactions } : m)
      );
    });

    // Tin nhắn được chỉnh sửa
    const offEdited = on('message:edited', async ({ messageId, content, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch, isEdited }) => {
      const decryptedText = await decryptIncomingMessage({ content, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch });
      setMessages(prev =>
        prev.map(m => m._id === messageId
          ? { ...m, content: decryptedText, decryptedText, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch, isEdited }
          : m)
      );
    });

    // Nhận Sender Key mới được phân phối cho thiết bị của mình (nhóm)
    const offSenderKeyNew = on('sender_key:new', async (dist) => {
      if (dist.room?.toString() !== room._id?.toString()) return;
      const devId = getDeviceId();
      const wrapped = dist.encryptedKeys?.[devId];
      if (!wrapped) return;
      try {
        const privateKey = await getPrivateKey(devId);
        if (!privateKey) return;
        const senderKey = await unwrapSenderKey(wrapped, privateKey);
        await storeSenderKey(room._id, dist.senderDeviceId, dist.epoch, senderKey);
      } catch (err) {
        console.error('[E2EE] Sender Key distribution error:', err);
      }
    });

    // Có người bấm "Xoay khóa nhóm" — cập nhật epoch hiện hành để lần gửi tiếp theo dùng khóa mới
    const offSenderKeyRotated = on('sender_key:rotated', ({ roomId: rId, epoch }) => {
      if (rId?.toString() === room._id?.toString()) setCurrentEpoch(epoch);
    });

    // Nếu mình đang giữ outbound Sender Key của phòng này thì phân phối lại (cùng epoch) cho
    // danh sách thiết bị truyền vào — dùng chung bởi cả 2 trigger bên dưới (đổi thiết bị / có
    // thành viên mới), không cần biết chi tiết gì hơn vì luôn wrap lại toàn bộ danh sách.
    const redistributeSenderKey = async (devicePublicKeys) => {
      const devId = getDeviceId();
      const cached = await getSenderKey(room._id, devId, currentEpoch);
      if (!cached) return;
      try {
        const encryptedKeys = await wrapSenderKeyForDevices(cached, devicePublicKeys);
        await api.post(`/rooms/${room._id}/sender-key`, { epoch: currentEpoch, senderDeviceId: devId, encryptedKeys });
      } catch (err) {
        console.error('[E2EE] Sender Key redistribution error:', err);
      }
    };

    // Thành viên trong nhóm thêm/xoay/gỡ thiết bị
    const offKeyChanged = on('key:changed', async ({ userId: changedUserId }) => {
      if (room.isDM) return;
      if (!roomMembers?.some(m => m._id?.toString() === changedUserId?.toString())) return;
      const allDevicePublicKeys = await fetchRoomDevicePublicKeys(room);
      await redistributeSenderKey(allDevicePublicKeys);
    });

    // Có thành viên mới vào phòng (join phòng công khai) — phân phối Sender Key hiện hành cho họ
    const offMemberJoined = on('room:member_joined', async ({ roomId: rId, member }) => {
      if (rId?.toString() !== room._id?.toString()) return;
      setRoomMembers(prev => prev.some(m => m._id === member._id) ? prev : [...prev, member]);
      if (room.isDM) return;
      const allDevicePublicKeys = await fetchRoomDevicePublicKeys({ members: [...roomMembers, member] });
      await redistributeSenderKey(allDevicePublicKeys);
    });

    // Có thành viên rời/bị kick — cập nhật danh sách thành viên đang hiển thị
    const offMemberLeft = on('room:member_left', ({ roomId: rId, userId: leftUserId }) => {
      if (rId?.toString() !== room._id?.toString()) return;
      setRoomMembers(prev => prev.filter(m => m._id?.toString() !== leftUserId?.toString()));
    });

    // Admin/chủ phòng thay đổi (phong/gỡ admin, chuyển quyền chủ phòng, hoặc kế vị khi chủ phòng rời)
    const offRoomUpdated = on('room:updated', ({ roomId: rId, admins: newAdmins, createdBy: newOwnerId }) => {
      if (rId?.toString() !== room._id?.toString()) return;
      if (newAdmins) setAdmins(newAdmins);
      if (newOwnerId) setOwnerId(newOwnerId);
    });

    // Có người xin vào phòng — thêm vào danh sách chờ duyệt đang hiển thị
    const offJoinRequested = on('room:join_requested', ({ roomId: rId, requester }) => {
      if (rId?.toString() !== room._id?.toString()) return;
      setJoinRequests(prev => prev.some(r => r._id === requester._id) ? prev : [...prev, requester]);
    });

    // Chủ phòng đổi tên, công khai/riêng tư, hoặc cần duyệt hay không
    const offSettingsUpdated = on('room:settings_updated', ({ roomId: rId, name, isPrivate, joinPolicy }) => {
      if (rId?.toString() !== room._id?.toString()) return;
      setRoomName(name);
      setRoomIsPrivate(isPrivate);
      setRoomJoinPolicy(joinPolicy);
    });

    // Typing indicator
    const offTypingStart = on('typing:start', ({ userId: uid, username, roomId }) => {
      if (roomId === room._id && uid !== user._id) {
        setTyping(prev => prev.includes(username) ? prev : [...prev, username]);
      }
    });
    const offTypingStop = on('typing:stop', ({ roomId }) => {
      if (roomId === room._id) setTyping([]);
    });

    // Trạng thái online/offline của DM partner
    const partner = getDMPartner(room, user);
    const offOnline = on('user:online', ({ userId }) => {
      if (userId?.toString() === partner?._id?.toString()) {
        setDmPartnerOnline(true);
      }
    });
    const offOffline = on('user:offline', ({ userId }) => {
      if (userId?.toString() === partner?._id?.toString()) {
        setDmPartnerOnline(false);
      }
    });

    return () => {
      offNew(); offDeleted(); offReacted(); offEdited();
      offSenderKeyNew(); offSenderKeyRotated(); offKeyChanged();
      offMemberJoined(); offMemberLeft(); offRoomUpdated(); offJoinRequested(); offSettingsUpdated();
      offTypingStart(); offTypingStop();
      offOnline(); offOffline();
    };
  }, [room, user, on, emit, isConnected, currentEpoch, roomMembers]);

  const roomId = room?._id;

  // Lấy Sender Key đầu ra đã cache cho (phòng, thiết bị mình, epoch) — nếu chưa có thì tạo mới,
  // phân phối (RSA-wrap) cho toàn bộ thiết bị đang hoạt động trong phòng rồi cache lại.
  const getOrCreateOutboundSenderKey = async (roomToUse, epochOverride) => {
    const devId = getDeviceId();
    const epoch = epochOverride ?? (roomToUse.senderKeyEpoch || 0);

    const cached = await getSenderKey(roomToUse._id, devId, epoch);
    if (cached) return { senderKey: cached, epoch };

    const senderKey = await generateSenderKey();
    const allDevicePublicKeys = await fetchRoomDevicePublicKeys(roomToUse);
    const encryptedKeys = await wrapSenderKeyForDevices(senderKey, allDevicePublicKeys);
    await api.post(`/rooms/${roomToUse._id}/sender-key`, { epoch, senderDeviceId: devId, encryptedKeys });
    await storeSenderKey(roomToUse._id, devId, epoch, senderKey);
    return { senderKey, epoch };
  };

  // Mã hóa nội dung cho 1 phòng — DM giữ nguyên RSA-per-device, phòng nhóm dùng Sender Key
  const encryptForRoom = async (roomToUse, text, epochOverride) => {
    if (roomToUse.isDM) {
      const allDevicePublicKeys = await fetchRoomDevicePublicKeys(roomToUse);
      const enc = await encryptMessageForRoom(text, allDevicePublicKeys);
      return { content: enc.content, iv: enc.iv, tag: enc.tag, encryptedKeys: enc.encryptedKeys };
    }

    const { senderKey, epoch } = await getOrCreateOutboundSenderKey(roomToUse, epochOverride);
    const enc = await encryptWithSenderKey(text, senderKey);
    return { content: enc.content, iv: enc.iv, tag: enc.tag, encryptedKeys: {}, scheme: 'sender-key', senderDeviceId: getDeviceId(), epoch };
  };

  const handleRotateKey = async () => {
    try {
      const { data } = await api.put(`/rooms/${room._id}/rotate-key`);
      setCurrentEpoch(data.epoch);
    } catch (err) {
      console.error('[E2EE] Rotate key error:', err);
      showError('Không thể xoay khóa nhóm');
    }
  };

  const handleLeaveRoom = async (newOwnerId) => {
    try {
      await api.post(`/rooms/${room._id}/leave`, newOwnerId ? { newOwnerId } : {});
      onBackToFriends();
    } catch (err) {
      console.error('[Room] Leave error:', err);
      showError(err.response?.data?.message || 'Không thể rời nhóm');
    }
  };

  const handleKickMember = async (memberId) => {
    try {
      await api.delete(`/rooms/${room._id}/members/${memberId}`);
    } catch (err) {
      console.error('[Room] Kick error:', err);
      showError(err.response?.data?.message || 'Không thể xóa thành viên khỏi nhóm');
    }
  };

  const handlePromoteAdmin = async (memberId) => {
    try {
      await api.put(`/rooms/${room._id}/admins/${memberId}`);
    } catch (err) {
      console.error('[Room] Promote admin error:', err);
      showError(err.response?.data?.message || 'Không thể phong quản trị viên');
    }
  };

  const handleDemoteAdmin = async (memberId) => {
    try {
      await api.delete(`/rooms/${room._id}/admins/${memberId}`);
    } catch (err) {
      console.error('[Room] Demote admin error:', err);
      showError(err.response?.data?.message || 'Không thể gỡ quyền quản trị viên');
    }
  };

  const handleTransferOwnership = async (memberId) => {
    try {
      await api.put(`/rooms/${room._id}/owner/${memberId}`);
    } catch (err) {
      console.error('[Room] Transfer ownership error:', err);
      showError(err.response?.data?.message || 'Không thể chuyển quyền chủ phòng');
    }
  };

  const handleOpenInvite = async () => {
    setShowInviteModal(true);
    setAddedMemberIds([]);
    // inviteCode không còn nằm trong room prop (GET /rooms, /rooms/all đã ẩn field này để
    // tránh lộ cho người ngoài) — phải tự fetch riêng qua route đã kiểm tra quyền thành viên.
    try {
      const { data } = await api.get(`/rooms/${room._id}/invite-code`);
      setInviteCode(data.inviteCode);
      setInviteCodeExpiresAt(data.inviteCodeExpiresAt);

      const url = `${window.location.origin}/?invite=${data.inviteCode}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 });
      setInviteQrDataUrl(dataUrl);
    } catch (err) {
      console.error('[Invite] Fetch/QR generate error:', err);
      showError('Không thể tải link mời');
    }

    if (isAdmin) {
      try {
        const { data } = await api.get('/friends');
        setFriendsToAdd(data);
      } catch (err) {
        console.error('[AddMember] Fetch friends error:', err);
      }
    }
  };

  // Thêm thẳng 1 bạn bè vào nhóm (họ tự accept/decline — xem FriendList.jsx tab "Lời mời vào nhóm")
  const handleAddMember = async (userId) => {
    try {
      await api.post(`/rooms/${room._id}/invites/${userId}`);
      setAddedMemberIds(prev => [...prev, userId]);
    } catch (err) {
      console.error('[AddMember] Invite error:', err);
      showError(err.response?.data?.message || 'Không thể thêm thành viên');
    }
  };

  const handleRotateInvite = async () => {
    try {
      const { data } = await api.put(`/rooms/${room._id}/rotate-invite`);
      setInviteCode(data.inviteCode);
      setInviteCodeExpiresAt(data.inviteCodeExpiresAt);
      const url = `${window.location.origin}/?invite=${data.inviteCode}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 });
      setInviteQrDataUrl(dataUrl);
    } catch (err) {
      console.error('[Invite] Rotate error:', err);
      showError(err.response?.data?.message || 'Không thể tạo lại link mời');
    }
  };

  const handleOpenSettings = () => {
    setSettingsNameInput(roomName || '');
    setSettingsPrivateInput(!roomIsPrivate); // hiện UI theo "Công khai" (đảo ngược isPrivate cho dễ hiểu)
    setSettingsApprovalInput(roomJoinPolicy === 'approval');
    setShowSettingsModal(true);
  };

  const handleSaveSettings = async () => {
    try {
      await api.put(`/rooms/${room._id}/settings`, {
        name: settingsNameInput,
        isPrivate: !settingsPrivateInput,
        joinPolicy: settingsPrivateInput && settingsApprovalInput ? 'approval' : 'open',
      });
      setShowSettingsModal(false);
    } catch (err) {
      console.error('[Room] Update settings error:', err);
      showError(err.response?.data?.message || 'Không thể lưu cài đặt phòng');
    }
  };

  const handleToggleJoinRequests = async () => {
    const next = !showJoinRequests;
    setShowJoinRequests(next);
    if (!next) return;
    try {
      const { data } = await api.get(`/rooms/${room._id}/join-requests`);
      setJoinRequests(data);
    } catch (err) {
      console.error('[Room] Fetch join requests error:', err);
    }
  };

  const handleApproveRequest = async (userId) => {
    try {
      await api.put(`/rooms/${room._id}/join-requests/${userId}`);
      setJoinRequests(prev => prev.filter(r => r._id !== userId));
    } catch (err) {
      console.error('[Room] Approve join request error:', err);
      showError(err.response?.data?.message || 'Không thể duyệt yêu cầu tham gia');
    }
  };

  const handleRejectRequest = async (userId) => {
    try {
      await api.delete(`/rooms/${room._id}/join-requests/${userId}`);
      setJoinRequests(prev => prev.filter(r => r._id !== userId));
    } catch (err) {
      console.error('[Room] Reject join request error:', err);
      showError(err.response?.data?.message || 'Không thể từ chối yêu cầu tham gia');
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'leave') {
      await handleLeaveRoom();
    } else if (confirmAction.type === 'kick') {
      await handleKickMember(confirmAction.memberId);
    } else if (confirmAction.type === 'transfer') {
      await handleTransferOwnership(confirmAction.memberId);
    } else if (confirmAction.type === 'promote') {
      await handlePromoteAdmin(confirmAction.memberId);
    } else if (confirmAction.type === 'demote') {
      await handleDemoteAdmin(confirmAction.memberId);
    }
    setConfirmAction(null);
  };

  const handleSend = useCallback(async (content, replyToId, type = 'text', fileName = null, ttlSeconds = null) => {
    try {
      // Dùng roomMembers (state sống, cập nhật realtime qua room:member_left/joined) thay vì
      // prop room (snapshot lúc mở phòng) — nếu không, Sender Key epoch mới vẫn bị wrap thừa
      // cho thiết bị của người vừa bị kick/rời, lộ tin nhắn nếu họ được thêm lại nhóm sau này.
      const payload = await encryptForRoom({ ...room, members: roomMembers }, content, currentEpoch);

      emit('message:send', {
        roomId,
        ...payload,
        type,
        replyTo: replyToId,
        fileName,
        ttlSeconds,
      });

      setReplyTo(null);
    } catch (err) {
      console.error('[E2EE] Send error:', err);
      showError('Không thể mã hóa tin nhắn E2EE');
    }
  }, [emit, roomId, room, roomMembers, currentEpoch, showError]);

  const handleTyping = useCallback((isTyping) => {
    emit(isTyping ? 'typing:start' : 'typing:stop', { roomId });
  }, [emit, roomId]);

  const handleReact = useCallback((messageId, emoji) => {
    emit('message:react', { messageId, emoji });
  }, [emit]);

  const handleForwardClick = useCallback((message) => {
    setForwardTargetMessage(message);
    setShowForward(true);
  }, []);

  const handleForwardSend = useCallback(async (targetRoomId, originalMsg) => {
    if (!originalMsg || originalMsg.isDeleted) {
      showError('Không thể chuyển tiếp tin nhắn đã bị thu hồi.');
      return;
    }

    try {
      const { data: rooms } = await api.get('/rooms');
      const targetRoom = rooms.find(r => r._id === targetRoomId);
      if (!targetRoom) {
        throw new Error('Không tìm thấy phòng để chuyển tiếp.');
      }

      const payload = await encryptForRoom(targetRoom, originalMsg.content);

      emit('message:send', {
        roomId: targetRoomId,
        ...payload,
        type: originalMsg.type,
        fileName: originalMsg.fileName,
        forwardedFrom: originalMsg._id
      });
    } catch (err) {
      console.error('[E2EE] Forward error:', err);
      showError('Không thể mã hóa tin nhắn chuyển tiếp.');
    }
  }, [emit, showError]);

  const handleEdit = useCallback(async (messageId, newContent) => {
    try {
      const payload = await encryptForRoom({ ...room, members: roomMembers }, newContent, currentEpoch);

      emit('message:edit', {
        messageId,
        ...payload,
      });
    } catch (err) {
      console.error('[E2EE] Edit error:', err);
      showError('Không thể mã hóa nội dung chỉnh sửa tin nhắn.');
    }
  }, [emit, room, roomMembers, currentEpoch, showError]);

  const loadMore = async () => {
    if (messages.length === 0) return;
    const cursor = messages[0].createdAt;
    const res = await api.get(`/rooms/${room._id}/messages?before=${encodeURIComponent(cursor)}&limit=30`);
    const decrypted = await processDecryption(res.data);
    setMessages(prev => [...decrypted, ...prev]);
    setHasMore(res.data.length === 30);
  };

  if (!room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-base-100 text-base-content/60 p-8 select-none">
        <span className="text-6xl mb-4 opacity-30">💬</span>
        <p className="text-lg font-bold text-base-content">Chào mừng bạn đến với Chat App!</p>
        <p className="text-sm opacity-70 mt-1">Chọn một phòng chat hoặc Bạn bè ở sidebar để bắt đầu trò chuyện.</p>
      </div>
    );
  }

  const dmPartner = getDMPartner(room, user);
  const displayName = room.isDM
    ? (dmPartner?.nickname || dmPartner?.username || 'Người dùng Messenger')
    : roomName;

  const onlineMembers = !room.isDM ? (roomMembers?.filter(m => m.isOnline) || []) : [];
  const offlineMembers = !room.isDM ? (roomMembers?.filter(m => !m.isOnline) || []) : [];
  const isOwner = !room.isDM && ownerId === user._id?.toString();
  const isAdmin = !room.isDM && (isOwner || admins.includes(user._id?.toString()));
  const inviteExpired = inviteCodeExpiresAt && new Date(inviteCodeExpiresAt) < new Date();

  // 1 dòng thành viên trong panel "Thông tin chi tiết" — dùng chung cho danh sách trực
  // tuyến/ngoại tuyến, khác nhau mỗi kiểu avatar/opacity.
  const renderMemberRow = (m, offline) => {
    const memberIsOwner = ownerId === m._id?.toString();
    const memberIsAdmin = !memberIsOwner && admins.includes(m._id?.toString());
    const canManage = isOwner && !memberIsOwner && m._id !== user._id;
    const canKick = isAdmin && !memberIsOwner && m._id !== user._id && (isOwner || !memberIsAdmin);

    return (
      <li key={m._id} className={offline ? 'opacity-70 hover:opacity-100' : ''}>
        <a onClick={() => onViewProfile && onViewProfile(m._id)} className="group">
          <div className={`avatar ${offline ? 'avatar-offline' : 'avatar-online'}`}>
            <div className="w-8 rounded-full">
              {m.avatar ? (
                <img src={m.avatar} alt="avatar" className={offline ? 'grayscale' : ''} />
              ) : (
                <div className={`w-full h-full flex items-center justify-center font-bold text-sm ${offline ? 'bg-base-300 text-base-content' : 'bg-primary text-primary-content'}`}>
                  {(m.nickname || m.username)[0].toUpperCase()}
                </div>
              )}
            </div>
          </div>
          <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors flex-1 flex items-center gap-1">
            {m.nickname || m.username}
            {memberIsOwner && (
              <span className="text-[9px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full flex-shrink-0 normal-case">Chủ phòng</span>
            )}
            {memberIsAdmin && (
              <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0 normal-case">Quản trị viên</span>
            )}
          </span>

          {canManage && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'transfer', memberId: m._id, memberName: m.nickname || m.username }); }}
                className="btn btn-2xs btn-ghost text-warning opacity-0 group-hover:opacity-100"
                title="Chuyển quyền chủ phòng"
              >
                <Crown className="w-3.5 h-3.5" />
              </button>
              {memberIsAdmin ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'demote', memberId: m._id, memberName: m.nickname || m.username }); }}
                  className="btn btn-2xs btn-ghost text-primary opacity-0 group-hover:opacity-100"
                  title="Gỡ quyền quản trị viên"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'promote', memberId: m._id, memberName: m.nickname || m.username }); }}
                  className="btn btn-2xs btn-ghost text-primary opacity-0 group-hover:opacity-100"
                  title="Phong quản trị viên"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          {canKick && (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'kick', memberId: m._id, memberName: m.nickname || m.username }); }}
              className="btn btn-2xs btn-ghost text-error opacity-0 group-hover:opacity-100"
              title="Xóa khỏi nhóm"
            >
              <UserX className="w-3.5 h-3.5" />
            </button>
          )}
        </a>
      </li>
    );
  };

  return (
    <div className="flex-1 flex flex-row h-full overflow-hidden bg-base-100 text-base-content relative">
      <Toast message={errorMsg} type="error" />
      {/* Vùng chat chính (giữa) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-base-100 relative">

        {/* Header phòng chat */}
        <div className="h-[60px] border-b border-base-300 px-4 flex items-center justify-between bg-base-100 flex-shrink-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            {/* Nút quay lại Bạn bè */}
            <button
              onClick={onBackToFriends}
              className="btn btn-circle btn-ghost btn-sm bg-base-200"
              title="Quay lại danh sách bạn bè"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Avatar Header & Tên */}
            <div
              className={`flex items-center gap-3 min-w-0 ${room.isDM && dmPartner && onViewProfile ? 'cursor-pointer group' : ''}`}
              onClick={() => {
                if (room.isDM && dmPartner && onViewProfile) {
                  onViewProfile(dmPartner._id);
                }
              }}
            >
              {room.isDM ? (
                <div className={`avatar ${dmPartnerOnline ? 'avatar-online' : 'avatar-offline'} flex-shrink-0`}>
                  <div className="w-10 rounded-full ring-1 ring-base-300 group-hover:ring-primary transition-all">
                    {dmPartner?.avatar ? (
                      <img src={dmPartner.avatar} alt="avatar" />
                    ) : (
                      <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold">
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary text-primary-content flex items-center justify-center font-bold text-base flex-shrink-0">
                  💬
                </div>
              )}

              <div className="flex flex-col leading-tight">
                <span className="font-bold truncate text-[15px] group-hover:text-primary transition-colors">{displayName}</span>
                <span className="text-[11px] text-base-content/50 font-medium">
                  {room.isDM
                    ? (dmPartnerOnline ? 'Đang hoạt động' : 'Không hoạt động')
                    : `${roomMembers?.length || 0} thành viên`
                  }
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Nút gọi thoại 1-1 (Xem mã an toàn E2EE đã chuyển vào Trang cá nhân) */}
            {room.isDM && dmPartner && (
              <>
                <button
                  onClick={() => onInitiateCall && onInitiateCall(dmPartner, 'audio')}
                  className="btn btn-circle btn-ghost btn-sm text-primary"
                  title="Bắt đầu cuộc gọi thoại"
                >
                  <Phone className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => onInitiateCall(dmPartner, 'video')}
                  className="btn btn-circle btn-ghost btn-sm"
                  title="Gọi video"
                >
                  <Video className="w-[18px] h-[18px]" />
                </button>
              </>
            )}

            {/* Nút bật/tắt Info Sidebar */}
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`btn btn-circle btn-ghost btn-sm ${showMembers ? 'bg-primary/10 text-primary' : ''}`}
              title="Thông tin cuộc trò chuyện"
            >
              <Info className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Danh sách tin nhắn */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 hide-scrollbar bg-base-100"
        >
          {hasMore && (
            <button className="btn btn-sm btn-ghost bg-base-200 self-center mb-4 rounded-full" onClick={loadMore}>
              Xem tin nhắn cũ hơn
            </button>
          )}

          <div className="flex flex-col gap-1.5">
            {messages.map((msg) => {
              return (
                <MessageItem
                  key={msg._id}
                  message={msg}
                  onReact={handleReact}
                  onReply={setReplyTo}
                  isGrouped={false}
                  isDM={room.isDM}
                  onForwardClick={handleForwardClick}
                  onEdit={handleEdit}
                  onViewProfile={onViewProfile}
                />
              );
            })}
          </div>

          {typing.length > 0 && (
            <p className="text-[11px] text-base-content/40 italic mt-1 px-4">
              💬 {typing.join(', ')} đang nhập...
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {showScrollBottom && (
          <button
            onClick={scrollToBottom}
            className="btn btn-circle btn-sm bg-base-100 border-base-300 shadow-md absolute bottom-20 right-6 text-base-content/60 hover:text-primary z-20 animate-bounce"
            title="Cuộn xuống dưới"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}

        {/* Ô nhập tin nhắn */}
        <div className="flex-shrink-0">
          <MessageInput
            onSend={handleSend}
            onTyping={handleTyping}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            roomId={room._id}
          />
        </div>
      </div>

      {/* Cột 4: Thông tin cuộc trò chuyện bên phải */}
      {showMembers && (
        <div className="w-[300px] bg-base-100 flex flex-col border-l border-base-300 flex-shrink-0">
          <div className="h-[60px] border-b border-base-300 px-4 flex items-center font-bold select-none flex-shrink-0 text-sm">
            Thông tin chi tiết
          </div>

          <div className="flex-1 overflow-y-auto hide-scrollbar p-4 flex flex-col items-center gap-6">
            {/* Ảnh đại diện phòng lớn ở cột thông tin */}
            <div
              className={`flex flex-col items-center gap-2 mt-4 text-center ${room.isDM && dmPartner && onViewProfile ? 'cursor-pointer group' : ''}`}
              onClick={() => {
                if (room.isDM && dmPartner && onViewProfile) {
                  onViewProfile(dmPartner._id);
                }
              }}
            >
              {room.isDM ? (
                <div className="avatar">
                  <div className="w-20 rounded-full ring-2 ring-base-300 group-hover:ring-primary transition-all">
                    {dmPartner?.avatar ? (
                      <img src={dmPartner.avatar} alt="avatar" />
                    ) : (
                      <div className="w-full h-full bg-primary flex items-center justify-center text-primary-content font-bold text-3xl">
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-primary to-secondary text-primary-content flex items-center justify-center font-bold text-4xl">
                  💬
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-2">
                <span className="font-bold text-lg group-hover:text-primary transition-colors">{displayName}</span>
                {!room.isDM && isOwner && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenSettings(); }}
                    className="btn btn-xs btn-circle btn-ghost text-base-content/50"
                    title="Đổi tên / công khai-riêng tư"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
              {!room.isDM && (
                <span className="text-[11px] text-base-content/40">
                  {roomIsPrivate ? 'Phòng riêng tư' : 'Phòng công khai'}
                </span>
              )}
              {room.isDM && (
                <span className="text-xs text-base-content/50">
                  {dmPartnerOnline ? 'Đang hoạt động' : 'Không hoạt động'}
                </span>
              )}
            </div>

            <div className="divider my-0 w-full" />

            {/* Mục thành viên (Nếu không phải DM) */}
            {!room.isDM && (
              <div className="w-full flex flex-col gap-4">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-xs font-bold text-base-content/50 uppercase tracking-wider">
                    Thành viên nhóm ({roomMembers?.length || 0})
                  </h4>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleOpenInvite}
                      className="btn btn-xs btn-ghost text-primary gap-1 normal-case"
                      title="Mời qua link hoặc mã QR"
                    >
                      <Link2 className="w-3 h-3" /> Mời
                    </button>
                    <button
                      onClick={handleRotateKey}
                      className="btn btn-xs btn-ghost text-primary gap-1 normal-case"
                      title="Tạo lại khóa mã hóa nhóm — dùng khi nghi ngờ 1 thiết bị trong nhóm bị lộ"
                    >
                      <RotateCw className="w-3 h-3" /> Xoay khóa
                    </button>
                  </div>
                </div>

                {isAdmin && (
                  <div className="w-full">
                    <button
                      onClick={handleToggleJoinRequests}
                      className="btn btn-xs btn-ghost text-warning gap-1 normal-case w-full justify-start px-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Yêu cầu tham gia {joinRequests.length > 0 && `(${joinRequests.length})`}
                    </button>
                    {showJoinRequests && (
                      <ul className="menu menu-sm p-0 gap-1 mt-1">
                        {joinRequests.length === 0 && (
                          <li className="text-[11px] text-base-content/40 italic px-2 py-1">Không có yêu cầu nào</li>
                        )}
                        {joinRequests.map(r => (
                          <li key={r._id}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm flex-1 truncate">{r.nickname || r.username}</span>
                              <button
                                onClick={() => handleApproveRequest(r._id)}
                                className="btn btn-2xs btn-ghost text-success"
                                title="Duyệt"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRejectRequest(r._id)}
                                className="btn btn-2xs btn-ghost text-error"
                                title="Từ chối"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="divider my-1" />
                  </div>
                )}

                <ul className="menu menu-sm p-0 gap-1 max-h-64 overflow-y-auto hide-scrollbar flex-nowrap">
                  {onlineMembers.map(m => renderMemberRow(m, false))}
                  {offlineMembers.map(m => renderMemberRow(m, true))}
                </ul>

                <button
                  onClick={() => {
                    const others = roomMembers.filter(m => (m._id || m)?.toString() !== user._id?.toString());
                    if (isOwner && others.length > 0) {
                      setLeaveNewOwnerId('');
                      setShowLeaveOwnerModal(true);
                    } else {
                      setConfirmAction({ type: 'leave' });
                    }
                  }}
                  className="btn btn-sm bg-error/10 hover:bg-error/20 text-error border-error/20 gap-1.5 w-full"
                >
                  <LogOut className="w-4 h-4" /> Rời nhóm
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal xác nhận rời nhóm / kick / cấp-hủy quyền admin / chuyển quyền chủ phòng */}
      {confirmAction && (
        <Modal onClose={() => setConfirmAction(null)} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
          <h3 className="text-base font-bold mb-2">
            {confirmAction.type === 'leave' && 'Rời khỏi nhóm này?'}
            {confirmAction.type === 'kick' && `Xóa ${confirmAction.memberName} khỏi nhóm?`}
            {confirmAction.type === 'transfer' && `Chuyển quyền chủ phòng cho ${confirmAction.memberName}?`}
            {confirmAction.type === 'promote' && `Phong ${confirmAction.memberName} làm quản trị viên?`}
            {confirmAction.type === 'demote' && `Gỡ quyền quản trị viên của ${confirmAction.memberName}?`}
          </h3>
          <p className="text-xs text-base-content/60 mb-4">
            {confirmAction.type === 'leave' && 'Bạn sẽ không nhận được tin nhắn mới từ nhóm này nữa. Có thể được mời lại sau.'}
            {confirmAction.type === 'kick' && 'Người này sẽ không đọc được tin nhắn mới của nhóm nữa.'}
            {confirmAction.type === 'transfer' && 'Bạn sẽ mất quyền chủ phòng (vẫn còn là quản trị viên). Chỉ chủ phòng mới chuyển quyền lại được.'}
            {confirmAction.type === 'promote' && 'Người này sẽ có quyền xóa thành viên thường khỏi nhóm.'}
            {confirmAction.type === 'demote' && 'Người này sẽ mất quyền xóa thành viên khỏi nhóm.'}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setConfirmAction(null)} className="btn btn-sm btn-ghost bg-base-200 rounded-full">
              Hủy
            </button>
            <button onClick={handleConfirmAction} className="btn btn-sm bg-error text-white hover:bg-error/90 rounded-full">
              Xác nhận
            </button>
          </div>
        </Modal>
      )}
      {/* Modal chọn chủ phòng mới khi CHỦ PHÒNG rời nhóm (bỏ qua thì tự động gán như cũ) */}
      {showLeaveOwnerModal && (
        <Modal onClose={() => setShowLeaveOwnerModal(false)} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
          <h3 className="text-base font-bold mb-2">Rời nhóm — chuyển quyền chủ phòng?</h3>
          <p className="text-xs text-base-content/60 mb-4">
            Bạn đang là chủ phòng. Chọn 1 thành viên để chuyển quyền trước khi rời, hoặc bỏ qua để hệ thống tự gán chủ phòng mới.
          </p>
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto hide-scrollbar mb-4">
            {roomMembers
              .filter(m => (m._id || m)?.toString() !== user._id?.toString())
              .map(m => {
                const mid = (m._id || m)?.toString();
                return (
                  <button
                    key={mid}
                    onClick={() => setLeaveNewOwnerId(mid)}
                    className={`flex items-center gap-2 p-2 rounded-lg text-left text-sm font-medium transition-colors ${
                      leaveNewOwnerId === mid ? 'bg-primary/10 text-primary ring-1 ring-primary' : 'hover:bg-base-200'
                    }`}
                  >
                    {m.nickname || m.username || 'Thành viên'}
                  </button>
                );
              })}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLeaveOwnerModal(false)} className="btn btn-sm btn-ghost bg-base-200 rounded-full">
              Hủy
            </button>
            <button
              onClick={() => { setShowLeaveOwnerModal(false); handleLeaveRoom(leaveNewOwnerId || undefined); }}
              className="btn btn-sm bg-error text-white hover:bg-error/90 rounded-full flex-1"
            >
              {leaveNewOwnerId ? 'Chuyển quyền & Rời nhóm' : 'Rời nhóm (tự động gán chủ mới)'}
            </button>
          </div>
        </Modal>
      )}
      {/* Modal đổi tên phòng / công khai-riêng tư (chỉ chủ phòng) */}
      {showSettingsModal && (
        <Modal onClose={() => setShowSettingsModal(false)} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
          <h3 className="text-base font-bold mb-3">Cài đặt phòng</h3>

          <div className="flex flex-col gap-3">
            <div className="form-control flex flex-col gap-1">
              <label className="text-xs font-bold text-base-content/70">Tên phòng</label>
              <input
                value={settingsNameInput}
                onChange={e => setSettingsNameInput(e.target.value)}
                className="input input-bordered input-sm w-full bg-base-200"
                autoFocus
              />
            </div>

            <label className="flex items-center justify-between text-xs cursor-pointer bg-base-200 rounded-xl px-3 py-2.5">
              <span>
                <span className="font-semibold">Phòng công khai</span>
                <br />
                <span className="text-base-content/50">Ai cũng tìm thấy ở mục tìm kiếm</span>
              </span>
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary"
                checked={settingsPrivateInput}
                onChange={e => setSettingsPrivateInput(e.target.checked)}
              />
            </label>

            {settingsPrivateInput && (
              <label className="flex items-center justify-between text-xs cursor-pointer bg-base-200 rounded-xl px-3 py-2.5">
                <span>
                  <span className="font-semibold">Cần duyệt khi có người xin vào</span>
                  <br />
                  <span className="text-base-content/50">Bạn phải duyệt từng người tìm thấy phòng và xin vào</span>
                </span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={settingsApprovalInput}
                  onChange={e => setSettingsApprovalInput(e.target.checked)}
                />
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setShowSettingsModal(false)} className="btn btn-sm btn-ghost bg-base-200 rounded-full">
              Hủy
            </button>
            <button onClick={handleSaveSettings} className="btn btn-sm btn-primary text-white rounded-full">
              Lưu
            </button>
          </div>
        </Modal>
      )}

      {/* Modal mời qua link/QR */}
      {showInviteModal && (
        <Modal onClose={() => setShowInviteModal(false)} boxClassName="max-w-sm bg-base-100 border border-base-300 shadow-2xl">
          <h3 className="text-base font-bold mb-3">Mời vào nhóm</h3>

          {inviteExpired && (
            <div className="alert alert-error py-2 px-3 text-xs font-semibold rounded-xl mb-3">
              <span>Link này đã hết hạn — người mới sẽ không tham gia được. {isOwner ? 'Hãy tạo lại link.' : 'Nhờ chủ phòng tạo lại link.'}</span>
            </div>
          )}

          <div className={`flex flex-col items-center gap-3 ${inviteExpired ? 'opacity-40' : ''}`}>
            {inviteQrDataUrl ? (
              <img src={inviteQrDataUrl} alt="QR mời vào nhóm" className="rounded-xl border border-base-300" />
            ) : (
              <div className="w-[220px] h-[220px] flex items-center justify-center bg-base-200 rounded-xl text-xs text-base-content/40">
                Đang tạo mã QR...
              </div>
            )}

            {inviteCode && (
              <div className="join w-full">
                <input
                  readOnly
                  value={`${window.location.origin}/?invite=${inviteCode}`}
                  className="input input-bordered input-sm join-item w-full bg-base-200 font-mono text-[11px]"
                  onClick={e => e.target.select()}
                />
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(`${window.location.origin}/?invite=${inviteCode}`);
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 1500);
                  }}
                  className="btn btn-sm btn-primary join-item text-white"
                >
                  <Copy className="w-3.5 h-3.5" /> {inviteCopied ? 'Đã copy' : 'Copy'}
                </button>
              </div>
            )}

            {!inviteExpired && inviteCodeExpiresAt && (
              <span className="text-[11px] text-base-content/40">
                Hết hạn {formatDistanceToNow(new Date(inviteCodeExpiresAt), { addSuffix: true, locale: vi })}
              </span>
            )}
          </div>

          {isOwner && (
            <button
              onClick={handleRotateInvite}
              className="btn btn-xs btn-ghost text-error gap-1 normal-case mt-3"
            >
              <RotateCw className="w-3 h-3" /> Tạo lại link (vô hiệu hóa link cũ, gia hạn thêm 7 ngày)
            </button>
          )}

          {isAdmin && (
            <div className="mt-4 pt-4 border-t border-base-300">
              <h4 className="text-xs font-bold text-base-content/60 uppercase tracking-wide mb-2">Thêm thành viên</h4>
              {friendsToAdd.length === 0 ? (
                <p className="text-xs text-base-content/40 italic">Chưa có bạn bè nào để thêm.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto hide-scrollbar">
                  {friendsToAdd.map(f => {
                    const friend = f.sender?._id?.toString() === user._id?.toString() ? f.receiver : f.sender;
                    if (!friend) return null;
                    const isMember = roomMembers.some(m => (m._id || m)?.toString() === friend._id?.toString());
                    const isAdded = addedMemberIds.includes(friend._id);
                    return (
                      <div key={friend._id} className="flex items-center justify-between gap-2">
                        <span className="text-sm truncate">{friend.nickname || friend.username}</span>
                        <button
                          disabled={isMember || isAdded}
                          onClick={() => handleAddMember(friend._id)}
                          className="btn btn-xs rounded-full font-semibold btn-primary text-white disabled:btn-disabled"
                        >
                          {isMember ? 'Đã trong nhóm' : isAdded ? 'Đã gửi lời mời' : 'Thêm'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
      {/* Modal chuyển tiếp tin nhắn */}
      <ForwardModal
        isOpen={showForward}
        onClose={() => setShowForward(false)}
        messageToForward={forwardTargetMessage}
        onForward={handleForwardSend}
      />
    </div>
  );
}