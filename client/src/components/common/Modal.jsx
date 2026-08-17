// Khung modal dùng chung — thay thế cặp div "modal modal-open" + "modal-box"
// đang bị viết tay lặp lại ở nhiều component. Nội dung modal (children) không đổi.
//
// - onClose (tùy chọn): bấm ra ngoài (backdrop) để đóng. Bỏ trống nếu modal không cho
//   đóng theo cách này (giữ đúng hành vi hiện tại của ForwardModal).
// - boxClassName: các class riêng của từng modal (kích thước, bo góc, viền...) — mỗi
//   modal khác nhau khá nhiều nên để nguyên chuỗi class thay vì tách thành nhiều prop.
// - zIndex: mặc định z-50; modal lồng trong modal khác cần z cao hơn (vd z-[60]).
export default function Modal({ onClose, boxClassName = 'max-w-md bg-base-100 border border-base-300 shadow-2xl', zIndex = 'z-50', children }) {
  return (
    <div className={`modal modal-open bg-black/50 backdrop-blur-sm ${zIndex}`} onClick={onClose}>
      <div className={`modal-box ${boxClassName}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
