export function normalizePatientName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function validPatientDob(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date() ? value : null;
}

export type PatientIdentity = {
  name?: string | null; dateOfBirth?: string | null; bloodGroup?: string | null;
  age?: number | null; gender?: string | null; identityConflicting?: boolean;
};

export function matchHealthPatient<T extends { name: string; dateOfBirth: Date | null; relation?: string; bloodGroup?: string | null; gender?: string | null }>(patient: PatientIdentity | null | undefined, members: T[], documentDate?: string | null) {
  const name = normalizePatientName(patient?.name ?? "");
  if (!name) return { status: "missing" as const, patient: patient ?? null, candidates: [] as T[] };
  const nameMatches = members.filter(member => normalizePatientName(member.name) === name);
  const dob = validPatientDob(patient?.dateOfBirth);
  const exact = nameMatches.filter(member => dob && member.dateOfBirth?.toISOString().slice(0, 10) === dob);
  const soleNameMatch = nameMatches.length === 1 ? nameMatches[0] : undefined;
  const candidate = exact.length === 1
    ? exact[0]
    : soleNameMatch && soleNameMatch.relation !== "Myself" ? soleNameMatch : undefined;
  const candidateDob = candidate?.dateOfBirth?.toISOString().slice(0, 10);
  const dobConflict = Boolean(dob && candidateDob && dob !== candidateDob);
  const ageDob = dob ?? candidateDob;
  const reportDate = validPatientDob(documentDate);
  const asOf = reportDate ?? new Date().toISOString().slice(0, 10);
  const expectedAge = ageDob ? Number(asOf.slice(0, 4)) - Number(ageDob.slice(0, 4)) - (asOf.slice(5) < ageDob.slice(5) ? 1 : 0) : null;
  const age = patient?.age;
  const ageConflict = age != null && (!Number.isInteger(age) || age < 0 || age > 120 || (expectedAge != null && (reportDate ? Math.abs(age - expectedAge) > 1 : age > expectedAge + 1)));
  const bloodConflict = candidate?.bloodGroup && patient?.bloodGroup && candidate.bloodGroup !== "Unknown" && patient.bloodGroup !== "Unknown" && candidate.bloodGroup !== patient.bloodGroup;
  const normalizeGender = (value?: string | null) => ({ m: "male", f: "female" }[value?.toLowerCase() ?? ""] ?? value?.toLowerCase());
  const genderConflict = candidate?.gender && patient?.gender && normalizeGender(candidate.gender) !== normalizeGender(patient.gender);
  if (candidate && !dobConflict && !patient?.identityConflicting && !bloodConflict && !genderConflict && !ageConflict) {
    return { status: "matched" as const, patient, candidates: [candidate], member: candidate };
  }
  const candidates = nameMatches.length || !dob ? nameMatches : members.filter(member => member.dateOfBirth?.toISOString().slice(0, 10) === dob);
  return { status: candidates.length || patient?.identityConflicting || ageConflict ? "ambiguous" as const : "unmatched" as const, patient, candidates };
}
