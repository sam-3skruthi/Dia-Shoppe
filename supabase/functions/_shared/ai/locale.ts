import type { Locale } from "./types.ts";

// Script detection is enough to pick a canned-message language. (Romanised Hindi/Kannada/Telugu is treated as English here;
// the model is asked to match the customer's language either way.)
export function detectLocale(text: string): Locale {
  let hi = 0, kn = 0, te = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0900 && c <= 0x097f) hi++;
    else if (c >= 0x0c80 && c <= 0x0cff) kn++;
    else if (c >= 0x0c00 && c <= 0x0c7f) te++;
  }
  const max = Math.max(hi, kn, te);
  if (max < 2) return "en";
  return max === hi ? "hi" : max === kn ? "kn" : "te";
}

// Canned replies: no model involved, so they are always safe. Hindi/Kannada/Telugu wording should be reviewed by a native speaker.
type Msgs = { handoff: string; refuse: string; noOrders: string; stop: string; start: string; media: string };
export const CANNED: Record<Locale, Msgs> = {
  en: {
    handoff: "Thank you for reaching out to Dia Shoppe! 🙏 A team member will get back to you shortly. For order updates, you can also track your order live on our website under My Orders.",
    refuse: "I can only share details of orders linked to this WhatsApp number, and I can't share internal business information. A Dia Shoppe team member can help you further.",
    noOrders: "I couldn't find any orders linked to this WhatsApp number. If you ordered with a different number, please tell our team and they will help.",
    stop: "You have been unsubscribed from Dia Shoppe offers and promotions. You will still receive important updates about your orders. Reply START to subscribe again.",
    start: "You are now subscribed to Dia Shoppe offers. Reply STOP at any time to unsubscribe.",
    media: "Thanks for your message! I can only read text messages here. A Dia Shoppe team member will look at what you sent and reply shortly.",
  },
  hi: {
    handoff: "Dia Shoppe से संपर्क करने के लिए धन्यवाद! 🙏 हमारी टीम का कोई सदस्य जल्द ही आपसे संपर्क करेगा। ऑर्डर की जानकारी आप हमारी वेबसाइट पर 'My Orders' में भी देख सकते हैं।",
    refuse: "मैं केवल इसी WhatsApp नंबर से जुड़े ऑर्डर की जानकारी दे सकता हूँ, और आंतरिक व्यावसायिक जानकारी साझा नहीं कर सकता। Dia Shoppe की टीम आपकी आगे मदद करेगी।",
    noOrders: "इस WhatsApp नंबर से जुड़ा कोई ऑर्डर नहीं मिला। यदि आपने किसी दूसरे नंबर से ऑर्डर किया है तो कृपया हमारी टीम को बताएं।",
    stop: "आपको Dia Shoppe के ऑफ़र और प्रचार संदेशों से हटा दिया गया है। आपके ऑर्डर की ज़रूरी जानकारी आपको मिलती रहेगी। दोबारा जुड़ने के लिए START लिखें।",
    start: "अब आप Dia Shoppe के ऑफ़र के लिए जुड़ गए हैं। कभी भी रुकने के लिए STOP लिखें।",
    media: "संदेश के लिए धन्यवाद! मैं यहाँ केवल टेक्स्ट संदेश पढ़ सकता हूँ। Dia Shoppe की टीम आपका भेजा हुआ देखकर जल्द जवाब देगी।",
  },
  kn: {
    handoff: "Dia Shoppe ಅನ್ನು ಸಂಪರ್ಕಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು! 🙏 ನಮ್ಮ ತಂಡದ ಸದಸ್ಯರು ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ನಿಮ್ಮ ಆರ್ಡರ್ ವಿವರಗಳನ್ನು ನಮ್ಮ ವೆಬ್‌ಸೈಟ್‌ನ 'My Orders' ನಲ್ಲಿಯೂ ನೋಡಬಹುದು.",
    refuse: "ಈ WhatsApp ಸಂಖ್ಯೆಗೆ ಸಂಬಂಧಿಸಿದ ಆರ್ಡರ್‌ಗಳ ವಿವರಗಳನ್ನು ಮಾತ್ರ ನಾನು ಹಂಚಿಕೊಳ್ಳಬಲ್ಲೆ, ಆಂತರಿಕ ವ್ಯವಹಾರ ಮಾಹಿತಿಯನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಸಾಧ್ಯವಿಲ್ಲ. Dia Shoppe ತಂಡ ನಿಮಗೆ ಮುಂದೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
    noOrders: "ಈ WhatsApp ಸಂಖ್ಯೆಗೆ ಸಂಬಂಧಿಸಿದ ಯಾವುದೇ ಆರ್ಡರ್ ಸಿಗಲಿಲ್ಲ. ನೀವು ಬೇರೆ ಸಂಖ್ಯೆಯಿಂದ ಆರ್ಡರ್ ಮಾಡಿದ್ದರೆ ದಯವಿಟ್ಟು ನಮ್ಮ ತಂಡಕ್ಕೆ ತಿಳಿಸಿ.",
    stop: "Dia Shoppe ಆಫರ್‌ಗಳು ಮತ್ತು ಪ್ರಚಾರ ಸಂದೇಶಗಳಿಂದ ನಿಮ್ಮನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ನಿಮ್ಮ ಆರ್ಡರ್‌ಗಳ ಮುಖ್ಯ ಮಾಹಿತಿ ನಿಮಗೆ ಬರುತ್ತಲೇ ಇರುತ್ತದೆ. ಮತ್ತೆ ಸೇರಲು START ಎಂದು ಕಳುಹಿಸಿ.",
    start: "ನೀವು ಈಗ Dia Shoppe ಆಫರ್‌ಗಳಿಗೆ ಸೇರಿದ್ದೀರಿ. ಯಾವಾಗ ಬೇಕಾದರೂ ನಿಲ್ಲಿಸಲು STOP ಎಂದು ಕಳುಹಿಸಿ.",
    media: "ನಿಮ್ಮ ಸಂದೇಶಕ್ಕೆ ಧನ್ಯವಾದಗಳು! ನಾನು ಇಲ್ಲಿ ಪಠ್ಯ ಸಂದೇಶಗಳನ್ನು ಮಾತ್ರ ಓದಬಲ್ಲೆ. Dia Shoppe ತಂಡ ನೀವು ಕಳುಹಿಸಿದ್ದನ್ನು ನೋಡಿ ಶೀಘ್ರದಲ್ಲೇ ಉತ್ತರಿಸುತ್ತದೆ.",
  },
  te: {
    handoff: "Dia Shoppe ని సంప్రదించినందుకు ధన్యవాదాలు! 🙏 మా బృందంలోని ఒకరు త్వరలో మిమ్మల్ని సంప్రదిస్తారు. మీ ఆర్డర్ వివరాలను మా వెబ్‌సైట్‌లోని 'My Orders' లో కూడా చూడవచ్చు.",
    refuse: "ఈ WhatsApp నంబర్‌కు సంబంధించిన ఆర్డర్ల వివరాలను మాత్రమే నేను చెప్పగలను, అంతర్గత వ్యాపార సమాచారాన్ని పంచుకోలేను. Dia Shoppe బృందం మీకు మరింత సహాయం చేస్తుంది.",
    noOrders: "ఈ WhatsApp నంబర్‌కు సంబంధించిన ఆర్డర్ ఏదీ కనబడలేదు. మీరు వేరే నంబర్‌తో ఆర్డర్ చేసి ఉంటే దయచేసి మా బృందానికి చెప్పండి.",
    stop: "Dia Shoppe ఆఫర్లు మరియు ప్రచార సందేశాల నుండి మిమ్మల్ని తొలగించాము. మీ ఆర్డర్‌ల ముఖ్యమైన సమాచారం మీకు వస్తూనే ఉంటుంది. మళ్లీ చేరడానికి START అని పంపండి.",
    start: "మీరు ఇప్పుడు Dia Shoppe ఆఫర్లకు చేరారు. ఎప్పుడైనా ఆపడానికి STOP అని పంపండి.",
    media: "మీ సందేశానికి ధన్యవాదాలు! నేను ఇక్కడ టెక్స్ట్ సందేశాలను మాత్రమే చదవగలను. Dia Shoppe బృందం మీరు పంపినది చూసి త్వరలో సమాధానం ఇస్తుంది.",
  },
};

// Does the text contain enough characters of the script the customer wrote in? (language-match guard for hi/kn/te)
export function hasScript(text: string, locale: Locale): boolean {
  if (locale === "en") return true;
  const range: [number, number] = locale === "hi" ? [0x0900, 0x097f] : locale === "kn" ? [0x0c80, 0x0cff] : [0x0c00, 0x0c7f];
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= range[0] && c <= range[1]) n++;
  }
  return n >= 5;
}
