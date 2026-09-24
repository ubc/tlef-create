# Course Materials

Materials are the evidence base used for learning-objective generation, question generation, and source references. Materials belong to a course and can be assigned to one or more learning objects in that course.

## Supported material sources

- **Files:** PDF, DOCX, and legacy DOC files through the upload control. The server's default file limit is 50 MB per file and can be changed by deployment configuration.
- **URLs:** direct PDF links and static web pages with extractable text. A deployment may restrict URLs to an allowlist shown beside the URL form.
- **Pasted text:** notes, transcripts, readings, or other text entered directly in CREATE.

Cloud-storage sharing links, direct image/audio/video files, and archive files are not accepted as URL materials. Download a cloud-hosted document first, then upload the file.

## Upload and processing states

File upload and content processing are separate stages. After a file reaches 100% upload, CREATE parses its content, creates retrievable chunks, and indexes them. URL and pasted-text materials are also processed before use. Do not generate grounded objectives or questions from a material until it reports a completed or ready state.

If processing remains pending, refresh once before retrying. If a source shows **Processing failed**, read the visible reason and select **Retry** on its material card. Re-uploading the same source repeatedly can create duplicate evidence and should be avoided. Learning-objective generation stays unavailable while an assigned source is pending or failed, but objectives can still be imported or entered manually.

All chunks must finish indexing before a material is ready. If embedding stops partway through, including a connection error such as **Premature close**, the material remains failed rather than appearing complete. Retry rebuilds its index after removing the previous partial result. A successful text split alone does not mean embeddings were saved.

If adding a URL or pasted text fails, the form stays open and retains your input. Correct the visible problem and submit again; a failed request is not reported as a successful upload.

If an administrator changes CREATE's retrieval model, previously completed
materials may need to be reprocessed once before they can supply evidence from
the new vector index. CREATE retains newly processed source files. Existing
extracted text can also be reused for re-indexing. If an older upload's file and
extracted text are both unavailable, upload that original again.

## Assign materials to a learning object

Open Step 1, **Materials**, in the Learning Object workflow and select the course materials that should ground that object. Assignment does not copy the source; it connects the existing course material to the learning object.

Choose the smallest relevant set. Unrelated, outdated, or duplicate materials can make retrieval less focused. If two sources conflict, remove the obsolete source or make the intended priority explicit in the one-time generation instructions.

## Preview extracted content

Use the eye icon on a material card to inspect a processed source. PDF materials open in CREATE's existing PDF viewer, starting at page 1 with page navigation and an **Open full PDF** action. URL, DOC/DOCX, and pasted-text materials show the cleaned text CREATE extracted; URL previews also provide an **Open original webpage** action, and Word previews can download the original file.

The extracted-text preview is useful for confirming that headings and important passages are present before generation. A visually correct original file can still produce incomplete extracted text, especially when a PDF contains scanned images rather than selectable text.

## Page numbers and source locations

PDF evidence retains page numbers when the parser can identify them. DOC/DOCX documents may not have stable printed page numbers, so their references can use sections or extracted chunks. URL and pasted-text materials use a section or chunk location. These differences are expected and do not by themselves mean grounding failed.

Visible chunk labels start at **Chunk 1** in both references and evidence graphs. They identify extracted sections, not printed page numbers.

## Replace or remove a material

Before removing a source, check whether learning objectives or questions cite it. Removing or replacing course evidence can make old references stale; regenerate or re-review dependent content afterward. A newly uploaded revision is a new material and is not automatically substituted into existing learning objects.

## Material troubleshooting

- **Unsupported file:** convert the source to PDF or DOCX and try again.
- **File too large:** reduce the file size or split it into coherent parts.
- **URL rejected:** use an allowed static page/direct PDF, or download and upload the content.
- **Preview is empty or garbled:** use a text-based/OCR version of the PDF or paste the important text.
- **No useful references:** confirm processing completed and the material is assigned to the current learning object.
