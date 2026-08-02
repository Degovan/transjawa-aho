import { loadDictionary } from "../dictionary";
import { Translator } from "../matcher/translator";

/**
 * Holds the active Translator in memory. The automaton is expensive to build
 * relative to a request, so we build once and reuse until /reload swaps it.
 */
class TranslatorStore {
  private translator: Translator | null = null;
  private patternCount = 0;
  private loadedAt: Date | null = null;

  async reload(): Promise<{ patternCount: number; loadedAt: Date }> {
    const dict = await loadDictionary();
    this.translator = new Translator(dict);
    this.patternCount = dict.patterns.length;
    this.loadedAt = new Date();
    return { patternCount: this.patternCount, loadedAt: this.loadedAt };
  }

  get(): Translator {
    if (!this.translator) {
      throw new Error("Translator not loaded yet");
    }
    return this.translator;
  }

  status() {
    return {
      ready: this.translator !== null,
      patternCount: this.patternCount,
      loadedAt: this.loadedAt,
    };
  }
}

export const translatorStore = new TranslatorStore();
