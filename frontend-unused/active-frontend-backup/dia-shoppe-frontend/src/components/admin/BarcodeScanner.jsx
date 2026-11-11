import { useEffect, useRef, useState } from 'react'
import { FiX, FiCamera } from 'react-icons/fi'

/*
  Camera barcode scanner for reading a courier AWB label.
  Uses the browser's built-in BarcodeDetector (Chrome on Android + desktop
  Chrome). Where it isn't available the dialog says so and the worker can
  still type the number by hand — scanning is a shortcut, never the only way.

  Note: the camera only works on https:// or localhost.
*/
export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  const streamRef = useRef(null)

  useEffect(() => {
    let stopped = false
    let raf

    const stop = () => {
      stopped = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }

    const run = async () => {
      if (!('BarcodeDetector' in window)) {
        setError("This browser can't scan barcodes — please type the tracking number instead. (Chrome on Android works best.)")
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera not available on this device.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        // AWB labels are usually Code128; include the common 1D/2D formats
        const detector = new window.BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code'],
        })
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const value = codes?.[0]?.rawValue?.trim()
            if (value) {
              stop()
              onDetected(value)
              return
            }
          } catch { /* frame not ready — keep going */ }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch (err) {
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access, or type the number by hand.'
            : `Could not start the camera: ${err?.message || err}`
        )
      }
    }

    run()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="font-display font-semibold text-ink-900 flex items-center gap-2">
            <FiCamera size={16} className="text-secondary-500" /> Scan courier label
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><FiX size={18} /></button>
        </div>

        {error ? (
          <p className="p-5 text-sm text-gray-600">{error}</p>
        ) : (
          <div className="relative bg-black">
            <video ref={videoRef} playsInline muted className="w-full h-64 object-cover" />
            {/* aiming guide */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-4/5 h-20 border-2 border-secondary-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          </div>
        )}

        <p className="px-4 py-3 text-xs text-gray-400">
          Point the camera at the barcode on the courier sticker. It fills in the tracking number automatically.
        </p>
      </div>
    </div>
  )
}
