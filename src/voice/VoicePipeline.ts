// Web Speech API types are not in lib.dom.d.ts in all TS versions — define minimally
interface SpeechRecognitionResultItem { transcript: string; confidence: number; }
interface SpeechRecognitionResult { isFinal: boolean; length: number; [index: number]: SpeechRecognitionResultItem; }
interface SpeechRecognitionResultList { length: number; resultIndex: number; [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEventLike extends Event { resultIndex: number; results: SpeechRecognitionResultList; }
interface SpeechRecognitionErrorEventLike extends Event { error: string; }
interface SpeechRecognitionInstance {
  continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend:    (() => void) | null;
  onerror:  ((e: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void; stop(): void;
}

export class VoicePipeline {
  private recognition: SpeechRecognitionInstance | null = null;
  private supported = false;

  constructor() {
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      const rec = new SpeechRec() as SpeechRecognitionInstance;
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;
      this.recognition = rec;
      this.supported = true;
    }
  }

  isSupported(): boolean {
    return this.supported;
  }

  /**
   * Listen for speech. Calls onInterim with partial transcript as user speaks.
   * Resolves with final transcript when speech ends.
   * Rejects after 15 seconds of silence or on error.
   */
  listen(onInterim?: (text: string) => void): Promise<string> {
    if (!this.recognition || !this.supported) {
      return Promise.reject(new Error('Speech recognition not supported'));
    }

    return new Promise((resolve, reject) => {
      let finalTranscript = '';
      const timeout = setTimeout(() => {
        this.recognition!.stop();
        reject(new Error('Timeout'));
      }, 15000);

      this.recognition!.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscript += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }
        onInterim?.(finalTranscript + interim);
      };

      this.recognition!.onend = () => {
        clearTimeout(timeout);
        resolve(finalTranscript.trim());
      };

      this.recognition!.onerror = (event: SpeechRecognitionErrorEventLike) => {
        clearTimeout(timeout);
        if (event.error === 'no-speech') {
          resolve('');
        } else {
          reject(new Error(event.error));
        }
      };

      this.recognition!.start();
    });
  }

  stop(): void {
    try {
      this.recognition?.stop();
    } catch (_) {}
  }
}
