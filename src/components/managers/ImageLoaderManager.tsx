import { useImageLoader } from '../../hooks/useImageLoader';
import { ImageFile } from '../ui/AppProperties';

interface Props {
  cachedEditStateRef: React.RefObject<any>;
  sortedImageList: ImageFile[];
}

export default function ImageLoaderManager({ cachedEditStateRef, sortedImageList }: Props) {
  useImageLoader(cachedEditStateRef, sortedImageList);

  return null;
}
