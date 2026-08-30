import { MessageCircle } from 'lucide-react';
import { CONTACT } from '../lib/contact';

// Fixed bottom-left so it never collides with the MARIA AI Assistant's
// draggable FAB, which defaults to the bottom-right corner.
export default function WhatsappFloat() {
  return (
    <a
      href={CONTACT.whatsappGroupUrl}
      target="_blank"
      rel="noreferrer"
      aria-label="Join our WhatsApp group"
      title="Join our WhatsApp group"
      className="fixed bottom-4 left-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl shadow-black/30 transition hover:scale-105"
    >
      <MessageCircle size={26} fill="currentColor" className="text-white" />
    </a>
  );
}
