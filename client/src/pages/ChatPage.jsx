import { useState, useEffect, useRef } from 'react';
import IconRail   from '../components/Chat/IconRail';
import Sidebar    from '../components/Chat/Sidebar';
import ChatWindow from '../components/Chat/ChatWindow';
import FriendList from '../components/Chat/FriendList';
import CallModal  from '../components/Chat/CallModal';
import OtherUserProfileModal from '../components/Profile/OtherUserProfileModal';
import ProfileModal from '../components/Profile/ProfileModal';
import KeyBackupModal from '../components/Settings/KeyBackupModal';
import { useSocket } from '../hooks/useSocket';
import useTimedMessage from '../hooks/useTimedMessage';

export default function ChatPage() {
  const [activeRoom, setActiveRoom] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showKeyBackup, setShowKeyBackup] = useState(false);
  const [toast, showToast] = useTimedMessage();

  // States cho tính năng cuộc gọi WebRTC
  const { on, emit } = useSocket();
  const [callState, setCallState] = useState('idle'); // 'idle' | 'ringing-out' | 'ringing-in' | 'active'
  const [callType, setCallType] = useState('video');   // 'video' | 'audio'
  const [callerInfo, setCallerInfo] = useState(null);
  const [receiverInfo, setReceiverInfo] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const targetUserIdRef = useRef(null);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Thiết lập Peer Connection
  const initiatePeerConnection = (targetId) => {
    const pc = new RTCPeerConnection(configuration);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emit('call:ice-candidate', { targetId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pcRef.current = pc;
    return pc;
  };

  // Khởi đầu cuộc gọi (Caller)
  const handleStartCall = async (partner, type) => {
    try {
      setCallState('ringing-out');
      setCallType(type);
      setReceiverInfo(partner);
      targetUserIdRef.current = partner._id;
      setIsMuted(false);
      setIsVideoOff(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true
      });
      setLocalStream(stream);
      localStreamRef.current = stream;

      const pc = initiatePeerConnection(partner._id);

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      emit('call:request', {
        receiverId: partner._id,
        signalData: offer,
        type
      });

    } catch (err) {
      console.error('Không thể bắt đầu cuộc gọi:', err);
      showToast('Không thể truy cập camera hoặc microphone.');
      cleanupCall();
    }
  };

  // Chấp nhận cuộc gọi (Receiver)
  const handleAcceptCall = async () => {
    if (!callerInfo) return;
    try {
      setCallState('active');
      const partnerId = callerInfo._id;
      targetUserIdRef.current = partnerId;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true
      });
      setLocalStream(stream);
      localStreamRef.current = stream;

      const pc = initiatePeerConnection(partnerId);

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      const offer = callerInfo.signalData;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      emit('call:accept', {
        callerId: partnerId,
        signalData: answer
      });

    } catch (err) {
      console.error('Không thể chấp nhận cuộc gọi:', err);
      showToast('Lỗi kết nối cuộc gọi.');
      cleanupCall();
    }
  };

  // Từ chối cuộc gọi
  const handleDeclineCall = () => {
    if (callerInfo) {
      emit('call:reject', { callerId: callerInfo._id });
    }
    cleanupCall();
  };

  // Hủy cuộc gọi khi đang đổ chuông đi
  const handleCancelCall = () => {
    if (targetUserIdRef.current) {
      emit('call:end', { targetId: targetUserIdRef.current });
    }
    cleanupCall();
  };

  // Gác máy khi đang gọi
  const handleEndCall = () => {
    if (targetUserIdRef.current) {
      emit('call:end', { targetId: targetUserIdRef.current });
    }
    cleanupCall();
  };

  // Dọn dẹp tài nguyên
  const cleanupCall = () => {
    setCallState('idle');
    setCallerInfo(null);
    setReceiverInfo(null);
    setRemoteStream(null);
    setLocalStream(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsMinimized(false);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    targetUserIdRef.current = null;
  };

  // Điều khiển track Mic/Camera
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Lắng nghe các sự kiện socket báo hiệu cuộc gọi
  useEffect(() => {
    const offCallRequest = on('call:request', ({ caller, signalData, type }) => {
      setCallState('ringing-in');
      setCallType(type);
      setCallerInfo({ ...caller, signalData });
      targetUserIdRef.current = caller._id;
    });

    const offCallAccept = on('call:accept', async ({ signalData }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(signalData));
        setCallState('active');
      }
    });

    const offCallReject = on('call:reject', () => {
      showToast('Người dùng bận hoặc đã từ chối cuộc gọi.');
      cleanupCall();
    });

    const offCallIceCandidate = on('call:ice-candidate', async ({ candidate }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Lỗi khi nạp ICE Candidate:', e);
        }
      }
    });

    const offCallEnd = on('call:end', () => {
      cleanupCall();
    });

    const offCallFailed = on('call:failed', ({ reason }) => {
      if (reason === 'offline') {
        showToast('Người dùng hiện đang ngoại tuyến.');
      } else {
        showToast('Cuộc gọi thất bại.');
      }
      cleanupCall();
    });

    return () => {
      offCallRequest();
      offCallAccept();
      offCallReject();
      offCallIceCandidate();
      offCallEnd();
      offCallFailed();
    };
  }, [on, showToast]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-100 text-base-content font-sans select-none relative">
      {/* Cột 0: Thanh icon điều hướng toàn app */}
      <IconRail
        view={activeRoom ? 'chat' : 'friends'}
        onSelectChat={() => {}}
        onSelectFriends={() => setActiveRoom(null)}
        onOpenProfile={() => setShowProfile(true)}
        onOpenKeyBackup={() => setShowKeyBackup(true)}
      />

      {/* Cột 1: Sidebar (Danh sách cuộc trò chuyện) */}
      <div className="w-[360px] flex-shrink-0 flex flex-col bg-base-100 border-r border-base-300">
        <Sidebar activeRoom={activeRoom} onSelectRoom={setActiveRoom} />
      </div>

      {/* Cột 2: Vùng nội dung chính */}
      <div className="flex-1 flex flex-col min-w-0 bg-base-100">
        {activeRoom ? (
          <ChatWindow
            key={activeRoom._id}
            room={activeRoom}
            onBackToFriends={() => setActiveRoom(null)}
            onInitiateCall={handleStartCall}
            onViewProfile={(userId) => setViewingUserId(userId)}
          />
        ) : (
          <FriendList
            onSelectDM={setActiveRoom}
            onViewProfile={(userId) => setViewingUserId(userId)}
          />
        )}
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showKeyBackup && <KeyBackupModal onClose={() => setShowKeyBackup(false)} />}

      {/* Cửa sổ Modal hiển thị cuộc gọi */}
      <CallModal
        callState={callState}
        callType={callType}
        callerInfo={callerInfo}
        receiverInfo={receiverInfo}
        localStream={localStream}
        remoteStream={remoteStream}
        onAccept={handleAcceptCall}
        onDecline={handleDeclineCall}
        onCancel={handleCancelCall}
        onEndCall={handleEndCall}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        isMinimized={isMinimized}
        setIsMinimized={setIsMinimized}
      />

      {/* Modal Xem Profile người dùng khác */}
      {viewingUserId && (
        <OtherUserProfileModal
          userId={viewingUserId}
          onClose={() => setViewingUserId(null)}
          onSelectRoom={setActiveRoom}
          onInitiateCall={handleStartCall}
        />
      )}

      {/* Toast thông báo lỗi/trạng thái cuộc gọi */}
      {toast && (
        <div className="toast toast-top toast-end z-[100]">
          <div className="alert alert-error text-sm">
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}