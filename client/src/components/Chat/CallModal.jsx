import { useEffect, useRef, useState } from 'react';

export default function CallModal({
  callState,
  callType,
  callerInfo,
  receiverInfo,
  localStream,
  remoteStream,
  onAccept,
  onDecline,
  onCancel,
  onEndCall,
  isMuted,
  isVideoOff,
  toggleMute,
  toggleCamera,
  isMinimized,
  setIsMinimized
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // States và Refs cho kéo thả (Drag & Drop) bong bóng nổi
  const [position, setPosition] = useState({ x: window.innerWidth - 160, y: window.innerHeight - 240 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const elementStartRef = useRef({ x: 0, y: 0 });

  // Gán stream vào thẻ video khi kết nối hoạt động
  useEffect(() => {
    if (callState === 'active') {
      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    }
  }, [callState, localStream, remoteStream, isMinimized]);

  // Chuông đổ cho ringing-out/ringing-in — tự sinh bằng Web Audio API, không cần file audio.
  useEffect(() => {
    if (callState !== 'ringing-out' && callState !== 'ringing-in') return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume().catch(() => {});
    let stopped = false;
    let timeoutId;

    // ringing-out: tút... (nghỉ dài) | ringing-in: chuông dồn dập 2 tông, lặp liên tục
    const pattern = callState === 'ringing-out'
      ? { freqs: [425], beepMs: 1000, gapMs: 3000 }
      : { freqs: [800, 1000], beepMs: 400, gapMs: 400 };

    const beep = () => {
      if (stopped) return;
      pattern.freqs.forEach(freq => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + pattern.beepMs / 1000);
      });
      timeoutId = setTimeout(beep, pattern.beepMs + pattern.gapMs);
    };
    beep();

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
      audioCtx.close();
    };
  }, [callState]);

  // Đặt lại vị trí mặc định khi bắt đầu cuộc gọi hoặc thu nhỏ
  useEffect(() => {
    if (isMinimized) {
      const defaultX = window.innerWidth - (callType === 'video' ? 160 : 110);
      const defaultY = window.innerHeight - (callType === 'video' ? 220 : 120);
      const timer = setTimeout(() => {
        setPosition({ x: defaultX, y: defaultY });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isMinimized, callType]);

  // Giới hạn bong bóng nổi khi thay đổi kích thước cửa sổ
  useEffect(() => {
    const handleResize = () => {
      const widthLimit = callType === 'video' ? 160 : 110;
      const heightLimit = callType === 'video' ? 220 : 120;
      setPosition(prev => ({
        x: Math.max(10, Math.min(prev.x, window.innerWidth - widthLimit)),
        y: Math.max(10, Math.min(prev.y, window.innerHeight - heightLimit))
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [callType]);

  // Xử lý kéo thả bằng chuột
  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return; // Không kéo khi click nút chức năng
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    elementStartRef.current = { x: position.x, y: position.y };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const widthLimit = callType === 'video' ? 160 : 110;
    const heightLimit = callType === 'video' ? 220 : 120;

    const newX = Math.max(10, Math.min(window.innerWidth - widthLimit, elementStartRef.current.x + deltaX));
    const newY = Math.max(10, Math.min(window.innerHeight - heightLimit, elementStartRef.current.y + deltaY));
    
    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Xử lý kéo thả bằng màn hình cảm ứng
  const handleTouchStart = (e) => {
    if (e.target.closest('button')) return;
    const touch = e.touches[0];
    isDraggingRef.current = true;
    dragStartRef.current = { x: touch.clientX, y: touch.clientY };
    elementStartRef.current = { x: position.x, y: position.y };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault(); // Chặn cuộn trang khi drag
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStartRef.current.x;
    const deltaY = touch.clientY - dragStartRef.current.y;

    const widthLimit = callType === 'video' ? 160 : 110;
    const heightLimit = callType === 'video' ? 220 : 120;

    const newX = Math.max(10, Math.min(window.innerWidth - widthLimit, elementStartRef.current.x + deltaX));
    const newY = Math.max(10, Math.min(window.innerHeight - heightLimit, elementStartRef.current.y + deltaY));
    
    setPosition({ x: newX, y: newY });
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
  };

  if (callState === 'idle') return null;

  const partner = callState === 'ringing-in' ? callerInfo : receiverInfo;
  const partnerName = partner?.nickname || partner?.username || 'Người dùng';
  const partnerAvatar = partner?.avatar;

  // LỰA CHỌN 1: KHI THU NHỎ (BONG BÓNG NỔI - FLOATING WIDGET)
  if (isMinimized && callState === 'active') {
    return (
      <div 
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ left: position.x, top: position.y }}
        className={`fixed z-50 select-none cursor-move transition-transform active:scale-95 duration-75 ${
          callType === 'video'
            ? 'w-[140px] h-[190px] rounded-2xl border-2 border-primary bg-black shadow-2xl overflow-hidden flex flex-col'
            : 'w-[90px] h-[90px] rounded-full border-2 border-primary bg-neutral shadow-2xl flex flex-col items-center justify-center'
        }`}
      >
        {callType === 'video' ? (
          // Khung nổi cho gọi Video
          <div className="w-full h-full relative group">
            {remoteStream ? (
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover pointer-events-none"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-900 text-[10px]">Kết nối...</div>
            )}

            {/* Video local phụ ở góc trên */}
            <div className="absolute top-1.5 right-1.5 w-8 h-12 rounded border border-white/20 overflow-hidden z-10 bg-black">
              {isVideoOff ? (
                <div className="w-full h-full bg-black flex items-center justify-center text-[7px] text-gray-500">Tắt</div>
              ) : (
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}
            </div>

            {/* Điều khiển thu nhỏ hover */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2 z-20">
              <div className="flex justify-between items-center w-full">
                {/* Nút phóng to */}
                <button
                  onClick={() => setIsMinimized(false)}
                  className="btn btn-circle btn-xs bg-black/60 hover:bg-black/80 border-none text-white"
                  title="Phóng to"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
                {/* Trạng thái mic */}
                <span className="text-[10px]">{isMuted ? '🎙️❌' : '🎙️'}</span>
              </div>

              {/* Nút Gác máy nhanh */}
              <button
                onClick={onEndCall}
                className="btn btn-circle btn-sm btn-error mx-auto shadow-md"
                title="Gác máy"
              >
                <svg className="w-4 h-4 text-white rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          // Khung nổi cho gọi thoại (Hình tròn)
          <div className="w-full h-full relative group flex items-center justify-center">
            {/* Nhịp thở nhấp nháy cho audio call */}
            <div className="absolute inset-0 rounded-full animate-ping bg-primary/10 z-0" />

            <div className="avatar z-10">
              <div className="w-14 rounded-full bg-primary border border-primary/60">
                {partnerAvatar ? (
                  <img src={partnerAvatar} alt="avatar" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary-content">
                    {partnerName[0].toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Video hidden để WebRTC audio tracks hoạt động */}
            <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

            {/* Các điều khiển hover hình tròn */}
            <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center gap-1 z-20">
              <div className="flex gap-2">
                <button
                  onClick={() => setIsMinimized(false)}
                  className="btn btn-circle btn-xs bg-black/80 hover:bg-black border-none text-white"
                  title="Phóng to"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
                <button
                  onClick={onEndCall}
                  className="btn btn-circle btn-xs btn-error"
                  title="Gác máy"
                >
                  <svg className="w-3.5 h-3.5 text-white rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
              </div>
              <span className="text-[8px] font-semibold">{isMuted ? 'Mute' : 'Mic On'}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // LỰA CHỌN 2: KHI HIỂN THỊ TOÀN MÀN HÌNH (FULL MODAL OVERLAY)
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 transition-all duration-300">
      <div className="bg-neutral text-neutral-content w-full max-w-sm h-full max-h-[600px] md:rounded-3xl shadow-2xl flex flex-col overflow-hidden relative border border-white/10">

        {/* Nút thu nhỏ ở chế độ Full screen (Chỉ hiện khi cuộc gọi đã kết nối active) */}
        {callState === 'active' && (
          <button
            onClick={() => setIsMinimized(true)}
            className="btn btn-circle btn-sm bg-black/40 hover:bg-black/60 border-none text-white absolute top-4 left-4 z-40"
            title="Thu nhỏ"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="10" y1="14" x2="3" y2="21" />
            </svg>
          </button>
        )}

        {/* Ringing Out (Đang gọi đi) */}
        {callState === 'ringing-out' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-pulse">
            <div className="avatar mb-6">
              <div className="w-24 rounded-full bg-primary text-3xl font-bold shadow-xl ring-4 ring-primary/20">
                {partnerAvatar ? (
                  <img src={partnerAvatar} alt="avatar" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-primary-content">{partnerName[0].toUpperCase()}</span>
                )}
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2">{partnerName}</h2>
            <p className="text-sm text-neutral-content/50 mb-16">Đang đổ chuông...</p>

            {/* Hủy cuộc gọi */}
            <button
              onClick={onCancel}
              className="btn btn-circle btn-lg btn-error shadow-lg"
              title="Hủy cuộc gọi"
            >
              <svg className="w-7 h-7 text-white rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
          </div>
        )}

        {/* Ringing In (Cuộc gọi đến) */}
        {callState === 'ringing-in' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="avatar mb-6">
              <div className="w-24 rounded-full bg-primary text-3xl font-bold shadow-xl ring-4 ring-primary/20 animate-bounce">
                {partnerAvatar ? (
                  <img src={partnerAvatar} alt="avatar" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-primary-content">{partnerName[0].toUpperCase()}</span>
                )}
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2">{partnerName}</h2>
            <p className="text-sm text-primary mb-16 font-semibold animate-pulse">
              {callType === 'video' ? 'Cuộc gọi video đến...' : 'Cuộc gọi thoại đến...'}
            </p>

            <div className="flex items-center gap-10">
              {/* Nút từ chối */}
              <button
                onClick={onDecline}
                className="btn btn-circle btn-lg btn-error shadow-lg"
                title="Từ chối"
              >
                <svg className="w-7 h-7 text-white rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>

              {/* Nút chấp nhận */}
              <button
                onClick={onAccept}
                className="btn btn-circle btn-lg btn-success shadow-lg"
                title="Trả lời"
              >
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Active Call (Đang kết nối gọi điện) */}
        {callState === 'active' && (
          <div className="flex-1 flex flex-col relative h-full bg-black">
            
            {/* Khung hiển thị Video */}
            {callType === 'video' ? (
              <div className="w-full h-full relative">
                {/* Video của đối phương (Khung chính) */}
                {remoteStream ? (
                  <video 
                    ref={remoteVideoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 bg-gray-900">
                    <span className="text-xl animate-pulse">Đang kết nối video...</span>
                  </div>
                )}

                {/* Video của chính mình (Khung nhỏ) */}
                <div className="absolute bottom-20 right-4 w-24 h-32 rounded-lg overflow-hidden border border-white/20 shadow-xl z-20 bg-gray-950">
                  {isVideoOff ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 bg-black text-[10px] font-semibold">Tắt Cam</div>
                  ) : (
                    <video 
                      ref={localVideoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              </div>
            ) : (
              // Audio Call (Khung giao diện thoại)
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-neutral">
                <div className="avatar mb-4">
                  <div className="w-24 rounded-full bg-primary text-3xl font-bold shadow-xl ring-2 ring-primary/20">
                    {partnerAvatar ? (
                      <img src={partnerAvatar} alt="avatar" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-primary-content">{partnerName[0].toUpperCase()}</span>
                    )}
                  </div>
                </div>
                <h2 className="text-xl font-bold mb-2">{partnerName}</h2>
                <p className="text-sm text-success font-semibold animate-pulse">Cuộc gọi thoại đang kết nối...</p>

                {/* Ẩn video element cho audio call để vẫn nhận tracks */}
                <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
                <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
              </div>
            )}

            {/* Các nút chức năng nổi ở dưới */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-4 z-40 bg-gradient-to-t from-black/60 to-transparent py-4 px-2">
              {/* Tắt/Mở Mic */}
              <button
                onClick={toggleMute}
                className={`btn btn-circle ${isMuted ? 'btn-error' : 'bg-white/10 hover:bg-white/20 border-white/10 text-white'}`}
                title={isMuted ? 'Bật Mic' : 'Tắt Mic'}
              >
                {isMuted ? '🎙️❌' : '🎙️'}
              </button>

              {/* Tắt/Mở Camera (chỉ cho Video Call) */}
              {callType === 'video' && (
                <button
                  onClick={toggleCamera}
                  className={`btn btn-circle ${isVideoOff ? 'btn-error' : 'bg-white/10 hover:bg-white/20 border-white/10 text-white'}`}
                  title={isVideoOff ? 'Bật Camera' : 'Tắt Camera'}
                >
                  {isVideoOff ? '📹❌' : '📹'}
                </button>
              )}

              {/* Gác máy */}
              <button
                onClick={onEndCall}
                className="btn btn-circle btn-error shadow-lg"
                title="Gác máy"
              >
                <svg className="w-5 h-5 text-white rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
