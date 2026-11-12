// Phonetic symbols with example words. Used to turn "/ʌ/" in task text into a
// button that plays an example word, so students can hear the sound.
export const SOUNDS = {
  'iː': ['see', 'tree'], 'ɪ': ['sit', 'fish'], 'e': ['bed', 'egg'], 'æ': ['cat', 'apple'],
  'ɑː': ['car', 'start'], 'ɒ': ['hot', 'clock'], 'ɔː': ['door', 'horse'], 'ʊ': ['book', 'good'],
  'uː': ['food', 'blue'], 'ʌ': ['up', 'cup'], 'ɜː': ['bird', 'girl'], 'ə': ['about', 'computer'],
  'eɪ': ['day', 'train'], 'aɪ': ['bike', 'time'], 'ɔɪ': ['boy', 'toy'], 'əʊ': ['phone', 'go'],
  'aʊ': ['house', 'now'], 'ɪə': ['here', 'ear'], 'eə': ['chair', 'where'], 'ʊə': ['tourist', 'sure'],
  'θ': ['think', 'three'], 'ð': ['the', 'mother'], 'ʃ': ['shower', 'she'], 'tʃ': ['chess', 'children'],
  'dʒ': ['jazz', 'job'], 'ʒ': ['television', 'usually'], 'ŋ': ['sing', 'long'], 'j': ['yes', 'you'],
  'w': ['we', 'window'], 'h': ['hat', 'house'], 's': ['snake', 'books'], 'z': ['zebra', 'keys'],
  'ɪz': ['watches', 'buses'], 't': ['tea', 'walked'], 'd': ['dog', 'played'], 'ɪd': ['wanted', 'needed'],
  'k': ['key', 'cat'], 'g': ['girl', 'go'], 'v': ['very', 'van'], 'f': ['fish', 'phone'],
  'r': ['red', 'right'], 'l': ['leg', 'lemon'], 'm': ['man', 'mother'], 'n': ['no', 'name'],
  'p': ['pen', 'parrot'], 'b': ['bag', 'bike'],
};

export const SOUND_RE = /\/([^/\s,.;:!?*]{1,3})\//g;
