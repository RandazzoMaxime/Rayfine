import { useMemo } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { RawStatus, EditedStatus, FlagStatus, SortDirection, ImageFile, GroupingMode } from '../components/ui/AppProperties';
import { buildDisplayGroups, effectiveGroupId, GroupBadgeInfo, GroupId } from '../utils/imageGrouping';

export const ADVANCED_QUERY_REGEX =
  /^(iso|aperture|f|shutter|s|focal|mm|rating|color|camera|make|model|lens)\s*(?::)?\s*(>=|<=|>|<|=)?\s*(.+)$/i;

export const parseShutter = (val: string | undefined): number => {
  if (!val) return 0;
  const cleanVal = val.replace(/s/i, '').trim();
  const parts = cleanVal.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den !== 0 ? num / den : 0;
  }
  const numVal = parseFloat(cleanVal);
  return isNaN(numVal) ? 0 : numVal;
};

export const parseAperture = (val: string | undefined): number => {
  if (!val) return 0;
  const match = val.match(/(\d+(\.\d+)?)/);
  const numVal = match ? parseFloat(match[0]) : 0;
  return isNaN(numVal) ? 0 : numVal;
};

export const parseFocalLength = (val: string | undefined): number => {
  if (!val) return 0;
  const match = val.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  const numVal = parseFloat(match[0]);
  return isNaN(numVal) ? 0 : numVal;
};

export interface GroupedLibrary {
  displayList: ImageFile[];
  badges: Map<GroupId, GroupBadgeInfo> | null;
}

export function computeGroupedLibrary(libraryState: any, settingsState: any): GroupedLibrary {
  const { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria, showPreviousImportOnly, lastImportedPaths, showQuickCollectionOnly, quickCollectionPaths, showSelectedOnly, multiSelectedPaths, libraryActivePath, expandedStackIds } = libraryState;
  const { appSettings } = settingsState;

  const groupingMode: GroupingMode = appSettings?.grouping ?? 'off';
  const isGroupingActive = groupingMode !== 'off';

  const matchesFilter = (image: ImageFile): boolean => {
    if (filterCriteria.rating !== 0) {
      const rating = imageRatings[image.path] || 0;
      if (filterCriteria.rating === -1 && rating !== 0) return false;
      if (filterCriteria.rating === 5 && rating !== 5) return false;
      if (filterCriteria.rating > 0 && filterCriteria.rating < 5 && rating < filterCriteria.rating) return false;
    }

    if (filterCriteria.rawStatus && filterCriteria.rawStatus !== RawStatus.All) {
      if (filterCriteria.rawStatus === RawStatus.RawOnly && !image.is_raw) return false;
      if (filterCriteria.rawStatus === RawStatus.NonRawOnly && image.is_raw) return false;
    }

    if (filterCriteria.editedStatus && filterCriteria.editedStatus !== EditedStatus.All) {
      if (filterCriteria.editedStatus === EditedStatus.EditedOnly && !image.is_edited) return false;
      if (filterCriteria.editedStatus === EditedStatus.UneditedOnly && image.is_edited) return false;
    }

    if (filterCriteria.colors && filterCriteria.colors.length > 0) {
      const imageColor = (image.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6);
      const hasMatchingColor = imageColor && filterCriteria.colors.includes(imageColor);
      const matchesNone = !imageColor && filterCriteria.colors.includes('none');

      if (!hasMatchingColor && !matchesNone) return false;
    }

    if (filterCriteria.flagStatus && filterCriteria.flagStatus !== FlagStatus.All) {
      const flagTag = (image.tags || []).find((tag: string) => tag.startsWith('flag:'))?.substring(5) || null;
      if (filterCriteria.flagStatus === FlagStatus.Pick && flagTag !== 'pick') return false;
      if (filterCriteria.flagStatus === FlagStatus.Reject && flagTag !== 'reject') return false;
      if (filterCriteria.flagStatus === FlagStatus.Unflagged && flagTag !== null) return false;
    }

    // LR: hide rejected from view (unless explicitly filtering to Rejects only)
    if (appSettings?.hideRejectedPhotos && filterCriteria.flagStatus !== FlagStatus.Reject) {
      const isRejected = (image.tags || []).some(
        (tag: string) => tag === 'flag:reject' || tag.endsWith(':reject'),
      );
      if (isRejected) return false;
    }

    if (showPreviousImportOnly && Array.isArray(lastImportedPaths) && lastImportedPaths.length > 0) {
      if (!lastImportedPaths.includes(image.path)) return false;
    }

    if (showQuickCollectionOnly && Array.isArray(quickCollectionPaths) && quickCollectionPaths.length > 0) {
      if (!quickCollectionPaths.includes(image.path)) return false;
    }

    if (showSelectedOnly) {
      const sel =
        Array.isArray(multiSelectedPaths) && multiSelectedPaths.length > 0
          ? multiSelectedPaths
          : libraryActivePath
            ? [libraryActivePath]
            : [];
      if (sel.length === 0 || !sel.includes(image.path)) return false;
    }


    if (filterCriteria.camera && String(filterCriteria.camera).trim()) {
      const cam = String(filterCriteria.camera).trim().toLowerCase();
      const makeModel = `${image.exif?.Make || ''} ${image.exif?.Model || ''}`.toLowerCase().trim();
      if (!makeModel.includes(cam) && makeModel !== cam) {
        // also allow exact model-only match
        const model = String(image.exif?.Model || '').toLowerCase();
        if (!model.includes(cam)) return false;
      }
    }

    if (filterCriteria.city && String(filterCriteria.city).trim()) {
      const city = String(filterCriteria.city).trim().toLowerCase();
      const imgCity = String(image.exif?.City || '').toLowerCase().trim();
      if (!imgCity || !imgCity.includes(city)) return false;
    }

    if (filterCriteria.country && String(filterCriteria.country).trim()) {
      const country = String(filterCriteria.country).trim().toLowerCase();
      const imgCountry = String(image.exif?.Country || '').toLowerCase().trim();
      if (!imgCountry || !imgCountry.includes(country)) return false;
    }

    if (filterCriteria.keyword && String(filterCriteria.keyword).trim()) {
      const kw = String(filterCriteria.keyword).trim().toLowerCase();
      const tags = (image.tags || []).map((tg: string) =>
        tg.toLowerCase().replace(/^user:/, '').replace(/^color:/, '').replace(/^flag:/, ''),
      );
      const hit = tags.some((tg: string) => tg.includes(kw));
      if (!hit) return false;
    }

    const dateFrom = filterCriteria.dateFrom?.trim();
    const dateTo = filterCriteria.dateTo?.trim();
    if (dateFrom || dateTo) {
      let day = '';
      if (filterCriteria.dateField === 'modified') {
        // image.modified is unix seconds or ms
        const m = Number(image.modified) || 0;
        if (m > 0) {
          const ms = m > 1e12 ? m : m * 1000;
          const d = new Date(ms);
          if (!Number.isNaN(d.getTime())) {
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            day = `${y}-${mo}-${da}`;
          }
        }
      } else {
        const raw = String(image.exif?.DateTimeOriginal || image.exif?.CreateDate || '').trim();
        // normalize to YYYY-MM-DD
        day = raw ? raw.slice(0, 10).replace(/:/g, '-') : '';
      }
      if (!day || day.length < 10) return false;
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
    }

    if (filterCriteria.lens && String(filterCriteria.lens).trim()) {
      const lensQ = String(filterCriteria.lens).trim().toLowerCase();
      const lensStr = `${image.exif?.LensModel || ''} ${image.exif?.Lens || ''} ${image.exif?.LensMake || ''}`
        .toLowerCase()
        .trim();
      if (!lensStr.includes(lensQ)) return false;
    }

    const isoMin = filterCriteria.isoMin;
    const isoMax = filterCriteria.isoMax;
    if (isoMin != null || isoMax != null) {
      const iso =
        parseInt(String(image.exif?.PhotographicSensitivity || image.exif?.ISOSpeedRatings || '0'), 10) || 0;
      if (isoMin != null && !Number.isNaN(isoMin) && iso < isoMin) return false;
      if (isoMax != null && !Number.isNaN(isoMax) && iso > isoMax) return false;
    }

    if (filterCriteria.hasGps && filterCriteria.hasGps !== 'all') {
      const lat = image.exif?.GPSLatitude;
      const lon = image.exif?.GPSLongitude;
      const has =
        lat != null &&
        lon != null &&
        String(lat).trim() !== '' &&
        String(lon).trim() !== '' &&
        String(lat) !== '0' &&
        String(lon) !== '0';
      if (filterCriteria.hasGps === 'yes' && !has) return false;
      if (filterCriteria.hasGps === 'no' && has) return false;
    }

    const apertureMin = filterCriteria.apertureMin;
    const apertureMax = filterCriteria.apertureMax;
    if (apertureMin != null || apertureMax != null) {
      const ap = parseAperture(image.exif?.FNumber);
      if (apertureMin != null && !Number.isNaN(apertureMin) && (ap === 0 || ap < apertureMin)) return false;
      if (apertureMax != null && !Number.isNaN(apertureMax) && (ap === 0 || ap > apertureMax)) return false;
    }

    const focalMin = filterCriteria.focalMin;
    const focalMax = filterCriteria.focalMax;
    if (focalMin != null || focalMax != null) {
      const fl = parseFocalLength(image.exif?.FocalLength);
      if (focalMin != null && !Number.isNaN(focalMin) && (fl === 0 || fl < focalMin)) return false;
      if (focalMax != null && !Number.isNaN(focalMax) && (fl === 0 || fl > focalMax)) return false;
    }

    const shutterMin = filterCriteria.shutterMin;
    const shutterMax = filterCriteria.shutterMax;
    if (shutterMin != null || shutterMax != null) {
      const sh = parseShutter(image.exif?.ExposureTime);
      if (shutterMin != null && !Number.isNaN(shutterMin) && (sh === 0 || sh < shutterMin)) return false;
      if (shutterMax != null && !Number.isNaN(shutterMax) && (sh === 0 || sh > shutterMax)) return false;
    }

    if (filterCriteria.fileExt && String(filterCriteria.fileExt).trim()) {
      const want = String(filterCriteria.fileExt).trim().toLowerCase().replace(/^\./, '');
      const path = String(image.path || '');
      const dot = path.lastIndexOf('.');
      const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
      if (ext !== want) return false;
    }


    
    const captionHay = (() => {
      const e = image.exif || {};
      return [
        e.ImageDescription,
        e.XPComment,
        e.XPTitle,
        e.Description,
        e.Caption,
        e['Caption-Abstract'],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    })();

    if (filterCriteria.caption && String(filterCriteria.caption).trim()) {
      const q = String(filterCriteria.caption).trim().toLowerCase();
      if (!captionHay.includes(q)) return false;
    }

    if (filterCriteria.hasCaption && filterCriteria.hasCaption !== 'all') {
      const has = captionHay.trim().length > 0;
      if (filterCriteria.hasCaption === 'yes' && !has) return false;
      if (filterCriteria.hasCaption === 'no' && has) return false;
    }

    if (filterCriteria.hasLocation && filterCriteria.hasLocation !== 'all') {
      const e = image.exif || {};
      const has =
        !!(e.City && String(e.City).trim()) ||
        !!(e.Country && String(e.Country).trim()) ||
        !!(e.Location && String(e.Location).trim()) ||
        !!(e.SubLocation && String(e.SubLocation).trim()) ||
        !!(e.State && String(e.State).trim()) ||
        !!(e.Province && String(e.Province).trim());
      if (filterCriteria.hasLocation === 'yes' && !has) return false;
      if (filterCriteria.hasLocation === 'no' && has) return false;
    }

    if (filterCriteria.hasPeople && filterCriteria.hasPeople !== 'all') {
      const has = !!(image.exif?.PersonInImage || image.exif?.['Person In Image']);
      if (filterCriteria.hasPeople === 'yes' && !has) return false;
      if (filterCriteria.hasPeople === 'no' && has) return false;
    }

    if (filterCriteria.hasEvent && filterCriteria.hasEvent !== 'all') {
      const has = !!(image.exif?.Event && String(image.exif.Event).trim());
      if (filterCriteria.hasEvent === 'yes' && !has) return false;
      if (filterCriteria.hasEvent === 'no' && has) return false;
    }

    if (filterCriteria.hasScene && filterCriteria.hasScene !== 'all') {
      const has = !!(image.exif?.Scene && String(image.exif.Scene).trim());
      if (filterCriteria.hasScene === 'yes' && !has) return false;
      if (filterCriteria.hasScene === 'no' && has) return false;
    }

    if (filterCriteria.hasGenre && filterCriteria.hasGenre !== 'all') {
      const g =
        image.exif?.IntellectualGenre ||
        image.exif?.['Intellectual Genre'] ||
        '';
      const has = !!(g && String(g).trim());
      if (filterCriteria.hasGenre === 'yes' && !has) return false;
      if (filterCriteria.hasGenre === 'no' && has) return false;
    }

    if (filterCriteria.hasSubjectCode && filterCriteria.hasSubjectCode !== 'all') {
      const sc =
        image.exif?.SubjectCode ||
        image.exif?.['Subject Code'] ||
        '';
      const has = !!(sc && String(sc).trim());
      if (filterCriteria.hasSubjectCode === 'yes' && !has) return false;
      if (filterCriteria.hasSubjectCode === 'no' && has) return false;
    }

    if (filterCriteria.hasCategory && filterCriteria.hasCategory !== 'all') {
      const has = !!(image.exif?.Category && String(image.exif.Category).trim());
      if (filterCriteria.hasCategory === 'yes' && !has) return false;
      if (filterCriteria.hasCategory === 'no' && has) return false;
    }

    if (filterCriteria.hasJobId && filterCriteria.hasJobId !== 'all') {
      const j =
        image.exif?.JobIdentifier ||
        image.exif?.JobID ||
        image.exif?.['Job Identifier'] ||
        '';
      const has = !!(j && String(j).trim());
      if (filterCriteria.hasJobId === 'yes' && !has) return false;
      if (filterCriteria.hasJobId === 'no' && has) return false;
    }

    if (filterCriteria.hasUrgency && filterCriteria.hasUrgency !== 'all') {
      const raw = image.exif?.Urgency;
      const n = raw != null && String(raw).trim() !== '' ? parseInt(String(raw), 10) : NaN;
      const has = Number.isFinite(n) && n >= 1 && n <= 8;
      if (filterCriteria.hasUrgency === 'yes' && !has) return false;
      if (filterCriteria.hasUrgency === 'no' && has) return false;
      if (
        filterCriteria.hasUrgency === 'yes' &&
        has &&
        filterCriteria.urgencyMax != null &&
        Number.isFinite(filterCriteria.urgencyMax) &&
        n > filterCriteria.urgencyMax
      ) {
        return false;
      }
    }

    if (filterCriteria.hasCaptionWriter && filterCriteria.hasCaptionWriter !== 'all') {
      const w =
        image.exif?.CaptionWriter ||
        image.exif?.['Caption Writer'] ||
        image.exif?.Writer ||
        '';
      const has = !!(w && String(w).trim());
      if (filterCriteria.hasCaptionWriter === 'yes' && !has) return false;
      if (filterCriteria.hasCaptionWriter === 'no' && has) return false;
    }

    if (filterCriteria.hasDigitalSource && filterCriteria.hasDigitalSource !== 'all') {
      const d =
        image.exif?.DigitalSourceType ||
        image.exif?.['Digital Source Type'] ||
        '';
      const has = !!(d && String(d).trim());
      if (filterCriteria.hasDigitalSource === 'yes' && !has) return false;
      if (filterCriteria.hasDigitalSource === 'no' && has) return false;
    }

    if (filterCriteria.hasHeadline && filterCriteria.hasHeadline !== 'all') {
      const has = !!(image.exif?.Headline && String(image.exif.Headline).trim());
      if (filterCriteria.hasHeadline === 'yes' && !has) return false;
      if (filterCriteria.hasHeadline === 'no' && has) return false;
    }

    if (filterCriteria.hasTitle && filterCriteria.hasTitle !== 'all') {
      const title =
        image.exif?.XPTitle || image.exif?.Title || image.exif?.['dc:title'] || '';
      const has = !!(title && String(title).trim());
      if (filterCriteria.hasTitle === 'yes' && !has) return false;
      if (filterCriteria.hasTitle === 'no' && has) return false;
    }

    if (filterCriteria.hasCredit && filterCriteria.hasCredit !== 'all') {
      const has = !!(image.exif?.Credit && String(image.exif.Credit).trim());
      if (filterCriteria.hasCredit === 'yes' && !has) return false;
      if (filterCriteria.hasCredit === 'no' && has) return false;
    }

    if (filterCriteria.hasSource && filterCriteria.hasSource !== 'all') {
      const has = !!(image.exif?.Source && String(image.exif.Source).trim());
      if (filterCriteria.hasSource === 'yes' && !has) return false;
      if (filterCriteria.hasSource === 'no' && has) return false;
    }

    if (filterCriteria.hasInstructions && filterCriteria.hasInstructions !== 'all') {
      const has = !!(image.exif?.Instructions && String(image.exif.Instructions).trim());
      if (filterCriteria.hasInstructions === 'yes' && !has) return false;
      if (filterCriteria.hasInstructions === 'no' && has) return false;
    }

    if (filterCriteria.hasCreator && filterCriteria.hasCreator !== 'all') {
      const has = !!(
        (image.exif?.Artist && String(image.exif.Artist).trim()) ||
        (image.exif?.Creator && String(image.exif.Creator).trim())
      );
      if (filterCriteria.hasCreator === 'yes' && !has) return false;
      if (filterCriteria.hasCreator === 'no' && has) return false;
    }

    if (filterCriteria.hasRights && filterCriteria.hasRights !== 'all') {
      const has = !!(
        (image.exif?.Copyright && String(image.exif.Copyright).trim()) ||
        (image.exif?.Rights && String(image.exif.Rights).trim()) ||
        (image.exif?.UsageTerms && String(image.exif.UsageTerms).trim()) ||
        (image.exif?.['Usage Terms'] && String(image.exif['Usage Terms']).trim())
      );
      if (filterCriteria.hasRights === 'yes' && !has) return false;
      if (filterCriteria.hasRights === 'no' && has) return false;
    }

    if (filterCriteria.hasJobTitle && filterCriteria.hasJobTitle !== 'all') {
      const has = !!(
        (image.exif?.AuthorsPosition && String(image.exif.AuthorsPosition).trim()) ||
        (image.exif?.['Authors Position'] && String(image.exif['Authors Position']).trim())
      );
      if (filterCriteria.hasJobTitle === 'yes' && !has) return false;
      if (filterCriteria.hasJobTitle === 'no' && has) return false;
    }

    if (filterCriteria.hasCity && filterCriteria.hasCity !== 'all') {
      const has = !!(image.exif?.City && String(image.exif.City).trim());
      if (filterCriteria.hasCity === 'yes' && !has) return false;
      if (filterCriteria.hasCity === 'no' && has) return false;
    }

    if (filterCriteria.hasCountry && filterCriteria.hasCountry !== 'all') {
      const has = !!(image.exif?.Country && String(image.exif.Country).trim());
      if (filterCriteria.hasCountry === 'yes' && !has) return false;
      if (filterCriteria.hasCountry === 'no' && has) return false;
    }

    if (filterCriteria.hasState && filterCriteria.hasState !== 'all') {
      const has = !!(
        (image.exif?.State && String(image.exif.State).trim()) ||
        (image.exif?.Province && String(image.exif.Province).trim())
      );
      if (filterCriteria.hasState === 'yes' && !has) return false;
      if (filterCriteria.hasState === 'no' && has) return false;
    }

    if (filterCriteria.hasSubLocation && filterCriteria.hasSubLocation !== 'all') {
      const has = !!(
        (image.exif?.Location && String(image.exif.Location).trim()) ||
        (image.exif?.SubLocation && String(image.exif.SubLocation).trim())
      );
      if (filterCriteria.hasSubLocation === 'yes' && !has) return false;
      if (filterCriteria.hasSubLocation === 'no' && has) return false;
    }

    if (filterCriteria.hasCountryCode && filterCriteria.hasCountryCode !== 'all') {
      const has = !!(
        (image.exif?.CountryCode && String(image.exif.CountryCode).trim()) ||
        (image.exif?.['Country Code'] && String(image.exif['Country Code']).trim())
      );
      if (filterCriteria.hasCountryCode === 'yes' && !has) return false;
      if (filterCriteria.hasCountryCode === 'no' && has) return false;
    }

    if (filterCriteria.hasUsageTerms && filterCriteria.hasUsageTerms !== 'all') {
      const has = !!(
        (image.exif?.UsageTerms && String(image.exif.UsageTerms).trim()) ||
        (image.exif?.['Usage Terms'] && String(image.exif['Usage Terms']).trim())
      );
      if (filterCriteria.hasUsageTerms === 'yes' && !has) return false;
      if (filterCriteria.hasUsageTerms === 'no' && has) return false;
    }

    if (filterCriteria.orientation && filterCriteria.orientation !== 'all') {
      const e = image.exif || {};
      const w =
        Number(image.width) ||
        parseFloat(String(e.ImageWidth || e.PixelXDimension || e.ExifImageWidth || '0')) ||
        0;
      const h =
        Number(image.height) ||
        parseFloat(String(e.ImageHeight || e.PixelYDimension || e.ExifImageHeight || '0')) ||
        0;
      if (w > 0 && h > 0) {
        const ratio = w / h;
        const mode = filterCriteria.orientation;
        if (mode === 'landscape' && ratio <= 1.02) return false;
        if (mode === 'portrait' && ratio >= 0.98) return false;
        if (mode === 'square' && (ratio < 0.95 || ratio > 1.05)) return false;
      } else {
        // Unknown dimensions: exclude when filtering by orientation
        return false;
      }
    }

if (filterCriteria.hasKeywords && filterCriteria.hasKeywords !== 'all') {
      const tags = image.tags || [];
      const hasKw = tags.some((tg: string) => tg.startsWith('user:'));
      if (filterCriteria.hasKeywords === 'yes' && !hasKw) return false;
      if (filterCriteria.hasKeywords === 'no' && hasKw) return false;
    }

    if (filterCriteria.hasStack && filterCriteria.hasStack !== 'all') {
      const tags = image.tags || [];
      const stacked = tags.some((tg: string) => tg.startsWith('stack:'));
      if (filterCriteria.hasStack === 'yes' && !stacked) return false;
      if (filterCriteria.hasStack === 'no' && stacked) return false;
    }

    if (filterCriteria.virtualCopies && filterCriteria.virtualCopies !== 'all') {
      const isVc = !!image.is_virtual_copy || String(image.path || '').includes('?vc=');
      if (filterCriteria.virtualCopies === 'yes' && !isVc) return false;
      if (filterCriteria.virtualCopies === 'no' && isVc) return false;
    }

    return true;
  };

  const { tags: searchTags, text: searchText, mode: searchMode } = searchCriteria;
  const lowerCaseSearchText = searchText.trim().toLowerCase();

  const parsedTags = searchTags.map((tag: string) => {
    const match = tag.match(ADVANCED_QUERY_REGEX);
    if (match) {
      const operator = match[2] || '=';
      return { type: 'query', field: match[1].toLowerCase(), operator, value: match[3].toLowerCase(), raw: tag };
    }
    return { type: 'normal', value: tag.toLowerCase(), raw: tag };
  });

  const evaluateQuery = (q: any, image: ImageFile) => {
    const { field, operator, value } = q;

    if (['iso', 'aperture', 'f', 'shutter', 's', 'focal', 'mm', 'rating'].includes(field)) {
      let imgVal = 0;
      let qVal = parseFloat(value);

      if (field === 'iso')
        imgVal = parseInt(image.exif?.PhotographicSensitivity || image.exif?.ISOSpeedRatings || '0', 10) || 0;
      else if (field === 'aperture' || field === 'f') imgVal = parseAperture(image.exif?.FNumber);
      else if (field === 'focal' || field === 'mm') imgVal = parseFocalLength(image.exif?.FocalLength);
      else if (field === 'rating') imgVal = imageRatings[image.path] || 0;
      else if (field === 'shutter' || field === 's') {
        imgVal = parseShutter(image.exif?.ExposureTime);
        qVal = parseShutter(value);
      }

      switch (operator) {
        case '>':
          return imgVal > qVal;
        case '<':
          return imgVal < qVal;
        case '>=':
          return imgVal >= qVal;
        case '<=':
          return imgVal <= qVal;
        case '=':
        case ':':
          return imgVal === qVal;
        default:
          return false;
      }
    } else {
      let imgStr = '';
      if (field === 'camera' || field === 'make' || field === 'model') {
        imgStr = `${image.exif?.Make || ''} ${image.exif?.Model || ''}`.toLowerCase();
      } else if (field === 'lens') {
        imgStr = String(
          `${image.exif?.LensModel || ''} ${image.exif?.Lens || ''} ${image.exif?.LensMake || ''}`,
        ).toLowerCase();
      } else if (field === 'color') {
        imgStr = (image.tags || []).find((t: string) => t.startsWith('color:'))?.substring(6) || '';
      }

      return operator === '=' || operator === ':' ? imgStr.includes(value) : false;
    }
  };

  const isSearchActive = parsedTags.length > 0 || lowerCaseSearchText !== '';

  const matchesSearch = (image: ImageFile): boolean => {
    if (!isSearchActive) return true;

    const lowerCaseImageTags = (image.tags || []).map((t) => t.toLowerCase().replace('user:', ''));
    const filename = image?.path?.split(/[\\/]/)?.pop()?.toLowerCase() || '';

    let tagsMatch = true;
    if (parsedTags.length > 0) {
      const evaluateTag = (parsedTag: any) => {
        if (parsedTag.type === 'normal') {
          return lowerCaseImageTags.some((imgTag) => imgTag.includes(parsedTag.value));
        }
        return evaluateQuery(parsedTag, image);
      };

      if (searchMode === 'OR') {
        tagsMatch = parsedTags.some((pt: any) => evaluateTag(pt));
      } else {
        tagsMatch = parsedTags.every((pt: any) => evaluateTag(pt));
      }
    }

    let textMatch = true;
    if (lowerCaseSearchText !== '') {
      textMatch =
        filename.includes(lowerCaseSearchText) || lowerCaseImageTags.some((t) => t.includes(lowerCaseSearchText));
    }

    return tagsMatch && textMatch;
  };

  // Always collapse manual stacks; also RAW/JPEG groups when grouping mode is on
  const groupEditedFiles = appSettings?.groupEditedFiles ?? true;
  const expandedIds: string[] = Array.isArray(expandedStackIds) ? expandedStackIds : [];
  const groupingResult = buildDisplayGroups(
    imageList,
    isGroupingActive ? groupingMode : 'off',
    groupEditedFiles,
    expandedIds,
  );
  let processedList = groupingResult.displayList;
  let searchMatchingGroupIds: Set<string> | null = null;

  if (isSearchActive) {
    searchMatchingGroupIds = new Set<string>();
    for (const image of imageList) {
      const gid = effectiveGroupId(image);
      if (!gid) continue;
      if (matchesSearch(image)) {
        searchMatchingGroupIds.add(gid);
      }
    }
  }

  const filteredList = processedList.filter((image: ImageFile) => matchesFilter(image));

  const filteredBySearch = !isSearchActive
    ? filteredList
    : filteredList.filter((image: ImageFile) => {
        if (searchMatchingGroupIds) { const gid = effectiveGroupId(image); if (gid && searchMatchingGroupIds.has(gid)) return true; }
        return matchesSearch(image);
      });

  const list = [...filteredBySearch];

  list.sort((a, b) => {
    const { key, order } = sortCriteria;
    let comparison = 0;

    switch (key) {
      case 'date_taken': {
        const dateA = a.exif?.DateTimeOriginal || '';
        const dateB = b.exif?.DateTimeOriginal || '';
        if (dateA !== dateB) comparison = dateA < dateB ? -1 : 1;
        else comparison = a.modified - b.modified;
        break;
      }
      case 'iso': {
        const isoA = parseInt(a.exif?.PhotographicSensitivity || a.exif?.ISOSpeedRatings || '0', 10) || 0;
        const isoB = parseInt(b.exif?.PhotographicSensitivity || b.exif?.ISOSpeedRatings || '0', 10) || 0;
        comparison = isoA - isoB;
        break;
      }
      case 'shutter_speed': {
        comparison = parseShutter(a.exif?.ExposureTime) - parseShutter(b.exif?.ExposureTime);
        break;
      }
      case 'aperture': {
        comparison = parseAperture(a.exif?.FNumber) - parseAperture(b.exif?.FNumber);
        break;
      }
      case 'focal_length': {
        comparison = parseFocalLength(a.exif?.FocalLength) - parseFocalLength(b.exif?.FocalLength);
        break;
      }
      case 'camera': {
        const camA = `${a.exif?.Make || ''} ${a.exif?.Model || ''}`.trim().toLowerCase();
        const camB = `${b.exif?.Make || ''} ${b.exif?.Model || ''}`.trim().toLowerCase();
        comparison = camA.localeCompare(camB);
        break;
      }
      case 'lens': {
        const lensA = `${a.exif?.LensModel || a.exif?.Lens || ''}`.trim().toLowerCase();
        const lensB = `${b.exif?.LensModel || b.exif?.Lens || ''}`.trim().toLowerCase();
        comparison = lensA.localeCompare(lensB);
        break;
      }
      case 'date':
        comparison = a.modified - b.modified;
        break;
      case 'rating':
        comparison = (imageRatings[a.path] || 0) - (imageRatings[b.path] || 0);
        break;
      case 'edited':
        comparison = a.is_edited === b.is_edited ? 0 : a.is_edited ? 1 : -1;
        break;
      case 'color':
      case 'color_label': {
        // LR color label order: none, red, yellow, green, blue, purple
        const order = ['red', 'yellow', 'green', 'blue', 'purple'];
        const rank = (img: ImageFile) => {
          const c = (img.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6) || '';
          const i = order.indexOf(c.toLowerCase());
          return i < 0 ? 99 : i;
        };
        comparison = rank(a) - rank(b);
        break;
      }
      case 'flag': {
        // Pick first, then unflagged, then reject (LR-ish cull order when ascending)
        const rank = (img: ImageFile) => {
          const f = (img.tags || []).find((tag: string) => tag.startsWith('flag:'))?.substring(5) || '';
          if (f === 'pick') return 0;
          if (f === 'reject') return 2;
          return 1;
        };
        comparison = rank(a) - rank(b);
        break;
      }
      case 'file_type': {
        const extOf = (img: ImageFile) => {
          if (img.is_raw) return '0_raw';
          const physical = String(img.path || '').split('?')[0];
          const name = physical.split(/[/\\]/).pop() || '';
          const dot = name.lastIndexOf('.');
          return (dot > 0 ? name.slice(dot + 1) : name).toLowerCase();
        };
        comparison = extOf(a).localeCompare(extOf(b));
        break;
      }
      case 'has_gps': {
        const has = (img: ImageFile) => {
          const lat = img.exif?.GPSLatitude ?? img.exif?.gpsLatitude;
          const lon = img.exif?.GPSLongitude ?? img.exif?.gpsLongitude;
          if (lat == null || lon == null || lat === '' || lon === '') return 0;
          return Number.isFinite(parseFloat(String(lat))) &&
            Number.isFinite(parseFloat(String(lon)))
            ? 1
            : 0;
        };
        comparison = has(a) - has(b);
        break;
      }

      case 'urgency': {
        const rank = (img: ImageFile) => {
          const n = parseInt(String(img.exif?.Urgency || ''), 10);
          if (!Number.isFinite(n) || n < 1 || n > 8) return 99;
          return n;
        };
        comparison = rank(a) - rank(b);
        break;
      }

      case 'category': {
        const cat = (img: ImageFile) =>
          String(img.exif?.Category || '')
            .trim()
            .toLowerCase();
        comparison = cat(a).localeCompare(cat(b));
        break;
      }

      case 'creator': {
        const cr = (img: ImageFile) =>
          String(img.exif?.Artist || img.exif?.Creator || '')
            .trim()
            .toLowerCase();
        comparison = cr(a).localeCompare(cr(b));
        break;
      }

      case 'credit': {
        const cr = (img: ImageFile) =>
          String(img.exif?.Credit || '')
            .trim()
            .toLowerCase();
        comparison = cr(a).localeCompare(cr(b));
        break;
      }

      case 'job_title': {
        const jt = (img: ImageFile) =>
          String(img.exif?.AuthorsPosition || img.exif?.['Authors Position'] || '')
            .trim()
            .toLowerCase();
        comparison = jt(a).localeCompare(jt(b));
        break;
      }

      case 'city': {
        const c = (img: ImageFile) =>
          String(img.exif?.City || '')
            .trim()
            .toLowerCase();
        comparison = c(a).localeCompare(c(b));
        break;
      }

      case 'country': {
        const c = (img: ImageFile) =>
          String(img.exif?.Country || '')
            .trim()
            .toLowerCase();
        comparison = c(a).localeCompare(c(b));
        break;
      }

      case 'state': {
        const s = (img: ImageFile) =>
          String(img.exif?.State || img.exif?.Province || '')
            .trim()
            .toLowerCase();
        comparison = s(a).localeCompare(s(b));
        break;
      }

      case 'sublocation': {
        const s = (img: ImageFile) =>
          String(img.exif?.Location || img.exif?.SubLocation || '')
            .trim()
            .toLowerCase();
        comparison = s(a).localeCompare(s(b));
        break;
      }

      case 'headline': {
        const h = (img: ImageFile) =>
          String(img.exif?.Headline || '')
            .trim()
            .toLowerCase();
        comparison = h(a).localeCompare(h(b));
        break;
      }

      case 'country_code': {
        const c = (img: ImageFile) =>
          String(img.exif?.CountryCode || img.exif?.['Country Code'] || '')
            .trim()
            .toLowerCase();
        comparison = c(a).localeCompare(c(b));
        break;
      }

      case 'usage_terms': {
        const u = (img: ImageFile) =>
          String(img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '')
            .trim()
            .toLowerCase();
        comparison = u(a).localeCompare(u(b));
        break;
      }

      default: {
        const nameA = a.path.split(/[\\/]/).pop() || a.path;
        const nameB = b.path.split(/[\\/]/).pop() || b.path;
        comparison = nameA.localeCompare(nameB);
        break;
      }
    }

    if (comparison === 0 && key !== 'name') {
      const nameA = a.path.split(/[\\/]/).pop() || a.path;
      const nameB = b.path.split(/[\\/]/).pop() || b.path;
      return nameA.localeCompare(nameB);
    }

    return order === SortDirection.Ascending ? comparison : -comparison;
  });

  const badges = groupingResult.badges.size > 0 ? groupingResult.badges : null;

  return { displayList: list, badges };
}

export function computeSortedLibrary(libraryState: any, settingsState: any): ImageFile[] {
  return computeGroupedLibrary(libraryState, settingsState).displayList;
}

export function useSortedLibrary() {
  const imageList = useLibraryStore((state) => state.imageList);
  const imageRatings = useLibraryStore((state) => state.imageRatings);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);
  const showPreviousImportOnly = useLibraryStore((state) => state.showPreviousImportOnly);
  const lastImportedPaths = useLibraryStore((state) => state.lastImportedPaths);
  const showQuickCollectionOnly = useLibraryStore((state) => state.showQuickCollectionOnly);
  const quickCollectionPaths = useLibraryStore((state) => state.quickCollectionPaths);
  const showSelectedOnly = useLibraryStore((state) => state.showSelectedOnly);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const libraryActivePath = useLibraryStore((state) => state.libraryActivePath);
  const expandedStackIds = useLibraryStore((state) => state.expandedStackIds);

  const appSettings = useSettingsStore((state) => state.appSettings);

  const result = useMemo(() => {
    return computeGroupedLibrary(
      {
        imageList,
        imageRatings,
        filterCriteria,
        searchCriteria,
        sortCriteria,
        showPreviousImportOnly,
        lastImportedPaths,
        showQuickCollectionOnly,
        quickCollectionPaths,
        showSelectedOnly,
        multiSelectedPaths,
        libraryActivePath,
        expandedStackIds,
      },
      { appSettings },
    );
  }, [
    imageList,
    sortCriteria,
    imageRatings,
    filterCriteria,
    searchCriteria,
    appSettings,
    showPreviousImportOnly,
    lastImportedPaths,
    showQuickCollectionOnly,
    quickCollectionPaths,
    showSelectedOnly,
    multiSelectedPaths,
    libraryActivePath,
    expandedStackIds,
  ]);

  return result;
}
