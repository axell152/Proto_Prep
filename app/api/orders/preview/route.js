import { parseProductionPdf } from '@/lib/pdfParser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const form =
      await request.formData();

    const file =
      form.get('file');

    if (
      !file ||
      typeof file.arrayBuffer !==
        'function'
    ) {
      return Response.json(
        {
          error:
            'Aucun PDF reçu.'
        },
        { status: 400 }
      );
    }

    const isPdf =
      file.type ===
        'application/pdf' ||
      file.name
        ?.toLowerCase()
        .endsWith('.pdf');

    if (!isPdf) {
      return Response.json(
        {
          error:
            'Le fichier doit être un PDF.'
        },
        { status: 400 }
      );
    }

    const buffer =
      Buffer.from(
        await file.arrayBuffer()
      );

    const parsed =
      await parseProductionPdf(
        buffer
      );

    return Response.json({
      filename:
        file.name,

      parsed
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          error.message ||
          'Analyse impossible.'
      },
      { status: 500 }
    );
  }
}
