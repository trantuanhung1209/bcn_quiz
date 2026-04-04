import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LegacyNotePayload = {
  note?: unknown;
  extraFilePaths?: unknown;
};

function parseLegacyNote(rawNote: string | null): {
  note: string | null;
  extraFilePaths: string[];
} {
  if (!rawNote) {
    return { note: null, extraFilePaths: [] };
  }

  try {
    const parsed = JSON.parse(rawNote) as LegacyNotePayload;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.extraFilePaths)) {
      return {
        note: typeof parsed.note === 'string' ? parsed.note : null,
        extraFilePaths: parsed.extraFilePaths.filter(
          (item): item is string => typeof item === 'string' && item.length > 0,
        ),
      };
    }
  } catch {
    // Keep backward compatibility for plain text note.
  }

  return { note: rawNote, extraFilePaths: [] };
}

async function main() {
  const submissions = await prisma.projectSubmission.findMany({
    include: {
      files: true,
    },
  });

  let createdRows = 0;
  let updatedNotes = 0;

  for (const submission of submissions) {
    const { note, extraFilePaths } = parseLegacyNote(submission.note);

    const existingFilePaths = new Set(submission.files.map((file) => file.filePath));
    const legacyCandidates = extraFilePaths.filter(
      (path): path is string => typeof path === 'string' && path.length > 0,
    );

    const normalizedLegacyPaths = [...new Set(legacyCandidates)];

    const rowsToCreate = normalizedLegacyPaths
      .filter((path) => !existingFilePaths.has(path))
      .map((path, index) => ({
        submissionId: submission.id,
        filePath: path,
        originalName: path.split('/').pop() ?? 'file',
        mimeType: null,
        fileSize: null,
        sortOrder: submission.files.length + index + 1,
      }));

    if (rowsToCreate.length > 0) {
      await prisma.projectSubmissionFile.createMany({
        data: rowsToCreate,
      });
      createdRows += rowsToCreate.length;
    }

    if (submission.note !== note) {
      await prisma.projectSubmission.update({
        where: { id: submission.id },
        data: { note },
      });
      updatedNotes += 1;
    }
  }

  console.log(`Submissions scanned: ${submissions.length}`);
  console.log(`ProjectSubmissionFile rows created: ${createdRows}`);
  console.log(`Submission notes normalized: ${updatedNotes}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
