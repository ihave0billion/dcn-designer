// Synthetic stencil masters for the vsdx writer tests — shaped like the
// Cisco pack's parts (entry element from masters.xml, masterN.xml, rels)
// but tiny, so no vendor bytes live in the repo.

import type { MasterAsset } from '../vsdx-writer'

const NS = "xmlns='http://schemas.microsoft.com/office/visio/2012/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'"

const RECT =
  "<Section N='Geometry' IX='0'>" +
  "<Row T='RelMoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
  "<Row T='RelLineTo' IX='2'><Cell N='X' V='1'/><Cell N='Y' V='0'/></Row>" +
  "<Row T='RelLineTo' IX='3'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row>" +
  "<Row T='RelLineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='1'/></Row>" +
  "<Row T='RelLineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>" +
  '</Section>'

function entry(id: number, name: string): string {
  return (
    `<Master ${NS} ID="${id}" NameU="${name}" IsCustomNameU="1" Name="${name}" IsCustomName="1" ` +
    'IconSize="1" AlignName="2" MatchByName="0" IconUpdate="1" UniqueID="{00000000-0000-0000-0000-000000000001}" ' +
    'PatternFlags="0" Hidden="0" MasterType="1">' +
    '<PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><Cell N="PageWidth" V="19" /><Cell N="PageHeight" V="1.7" />' +
    '<Cell N="PageScale" V="1" U="IN" /><Cell N="DrawingScale" V="10" U="IN" /></PageSheet>' +
    '<Rel r:id="rId9" /></Master>'
  )
}

/** A group master: 19×1.7 in box with one child rectangle. No media. */
export const BOX_MASTER: MasterAsset = {
  name: 'Test Box Front',
  entryXml: entry(497, 'Test Box Front'),
  masterXml:
    "<?xml version='1.0' encoding='utf-8' ?>" +
    `<MasterContents ${NS} xml:space='preserve'><Shapes>` +
    "<Shape ID='5' Type='Group' LineStyle='3' FillStyle='3' TextStyle='3'>" +
    "<Cell N='PinX' V='9.5'/><Cell N='PinY' V='0.85'/><Cell N='Width' V='19'/><Cell N='Height' V='1.7'/>" +
    "<Cell N='LocPinX' V='9.5'/><Cell N='LocPinY' V='0.85'/>" +
    '<Shapes>' +
    "<Shape ID='6' Type='Shape' LineStyle='2' FillStyle='2' TextStyle='2'>" +
    "<Cell N='PinX' V='9.5'/><Cell N='PinY' V='0.85'/><Cell N='Width' V='19'/><Cell N='Height' V='1.7'/>" +
    "<Cell N='FillForegnd' V='#CCCCCC'/>" +
    RECT +
    '</Shape>' +
    '</Shapes></Shape></Shapes></MasterContents>',
  relsXml: null,
  media: {},
  widthIn: 19,
  heightIn: 1.7
}

/** A master with one EMF media part, like every Cisco front-panel master. */
export const EMF_MASTER: MasterAsset = {
  name: 'Test EMF Front',
  entryXml: entry(498, 'Test EMF Front'),
  masterXml:
    "<?xml version='1.0' encoding='utf-8' ?>" +
    `<MasterContents ${NS} xml:space='preserve'><Shapes>` +
    "<Shape ID='5' Type='Group' LineStyle='3' FillStyle='3' TextStyle='3'>" +
    "<Cell N='PinX' V='9.5'/><Cell N='PinY' V='1.0'/><Cell N='Width' V='19'/><Cell N='Height' V='2'/>" +
    '<Shapes>' +
    "<Shape ID='6' Type='Foreign' LineStyle='2' FillStyle='2' TextStyle='2'>" +
    "<Cell N='PinX' V='9.5'/><Cell N='PinY' V='1'/><Cell N='Width' V='19'/><Cell N='Height' V='2'/>" +
    RECT +
    "<ForeignData ForeignType='MetaFile'><Rel r:id='rId1'/></ForeignData>" +
    '</Shape>' +
    "<Shape ID='7' Type='Group'><Shapes><Shape ID='8' Type='Shape'>" +
    RECT +
    '</Shape></Shapes></Shape>' +
    '</Shapes></Shape></Shapes></MasterContents>',
  relsXml:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/>' +
    '</Relationships>',
  media: { 'image1.emf': new Uint8Array([1, 0, 0, 0, 0xde, 0xad, 0xbe, 0xef]) },
  widthIn: 0, // exercise the read-from-XML path
  heightIn: 0
}

/** Smallest valid PNG (1×1, opaque white) for image() tests. */
export const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
])

/** A 4×2 PNG header only (enough for imagePixelSize; not a full file). */
export const PNG_4X2_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00
])
