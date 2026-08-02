export function scoreDrivingLicenceText(text: string) {
  const haystack = text.replace(/\s+/g, " ").toUpperCase();
  const keywordSignals: Array<[RegExp, number]> = [
    [/\bINDIAN UNION DRIVING LICEN[CS]E\b/, 80],
    [/\bDRIVING LICEN[CS]E\b/, 70],
    [/\bLICEN[CS]ING AUTHORITY\b/, 45],
    [/\bTELANGANA STATE\b/, 45],
    [/\bTELANGANA\b/, 30],
    [/\bLICEN[CS]E\b/, 30],
    [/\bRTA\b/, 30],
    [/\bTRANSPORT\b/, 12],
    [/\bVALID\b/, 8],
  ];
  const regexSignals: Array<[RegExp, number]> = [
    [/\bTS[0-9]{2,}\b/, 45],
    [/\bAP[0-9]{2,}\b/, 35],
    [/\b[A-Z]{2}[0-9]{13,}\b/, 50],
  ];

  return {
    keywordScore: keywordSignals.reduce(
      (sum, [pattern, points]) => sum + (pattern.test(haystack) ? points : 0),
      0,
    ),
    regexScore: regexSignals.reduce(
      (sum, [pattern, points]) => sum + (pattern.test(haystack) ? points : 0),
      0,
    ),
  };
}

export function scorePassportText(text: string) {
  const haystack = text.replace(/\s+/g, " ").toUpperCase();
  const compact = haystack.replace(/\s+/g, "");
  const keywordSignals: Array<[RegExp, number]> = [
    [/\bREPUBLIC OF INDIA\b/, 65],
    [/\bPASSPORT\b/, 55],
    [/\bPASSPORT NO\b/, 45],
    [/\bNATIONALITY\b/, 20],
    [/\bPLACE OF BIRTH\b/, 18],
    [/\bDATE OF ISSUE\b/, 18],
    [/\bDATE OF EXPIRY\b/, 18],
  ];
  const regexSignals: Array<[RegExp, number]> = [
    [/\b[A-Z][0-9]{7}\b/, 55],
    [/P<+IND[A-Z<]{8,}/, 70],
    [/[A-Z][0-9]{7}IND[0-9]{6,}/, 65],
    [/<{2,}[A-Z]{3,}<{2,}/, 40],
  ];

  return {
    keywordScore: keywordSignals.reduce(
      (sum, [pattern, points]) => sum + (pattern.test(haystack) ? points : 0),
      0,
    ),
    regexScore: regexSignals.reduce(
      (sum, [pattern, points]) =>
        sum + (pattern.test(compact) || pattern.test(haystack) ? points : 0),
      0,
    ),
  };
}

export function scoreTextQuality(text: string) {
  const alnum = text.match(/[A-Za-z0-9]/g)?.length ?? 0;
  const letters = text.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  const digits = text.match(/[0-9]/g)?.length ?? 0;
  const separators = text.match(/[|_[\]{}~^`]/g)?.length ?? 0;
  const usefulLength = alnum + letters * 3 + digits;
  const noisePenalty = Math.min(30, separators * 1.5);

  return Math.max(0, Math.min(100, usefulLength - noisePenalty));
}
