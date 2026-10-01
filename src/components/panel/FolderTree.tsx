import {
  Folder,
  FolderOpen,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Search,
  X,
  Album as AlbumIcon,
  Plus,
  Plane,
  Mountain,
  Sun,
  Camera,
  Map,
  Heart,
  Star,
  Users,
  User,
  Car,
  Briefcase,
  ArrowUpDown,
  Check,
  Flag,
  FlagOff,
  Images,
  Layers,
  FolderInput,
  MapPin,
  Tags,
  Copy,
  Calendar,
  FileText,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import Text from '../ui/Text';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../types/typography';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { AlbumItem, AlbumGroup, Album, Invokes, FolderTreeSort, SortDirection, FlagStatus, EditedStatus, RawStatus } from '../ui/AppProperties';
import { COLOR_LABELS } from '../../utils/adjustments';
import {
  UNCATEGORIZED_ALBUM_ID,
  albumDisplayName,
  ensureUncategorizedAlbum,
} from '../../utils/catalogMembership';
import { groupTreesByDrive, isDriveRootPath, mergeImportedBranches, type PathBranch } from '../../utils/libraryRoots';

export interface FolderTree {
  children: FolderTree[];
  isDir: boolean;
  name: string;
  path: string;
  imageCount?: number;
  hasSubdirs?: boolean;
  modified?: number;
  created?: number;
}

interface FolderTreeProps {
  isResizing: boolean;
  isVisible: boolean;
  onContextMenu(event: any, path: string | null, isPinned?: boolean): void;
  onAlbumContextMenu(event: any, item: AlbumItem | null): void;
  onFolderSelect(folder: string): void;
  onSelectAlbum(albumId: string, albumName: string, images: string[]): void;
  onToggleFolder(folder: string): void;
  onOpenFolder(): void;
  setIsVisible(visible: boolean): void;
  style: any;
  isInstantTransition: boolean;
}

interface TreeNodeProps {
  expandedFolders: Set<string>;
  isExpanded: boolean;
  node: FolderTree;
  onContextMenu(event: any, path: string, isPinned?: boolean): void;
  onFolderSelect(folder: string): void;
  onToggle(path: string): void;
  selectedPath: string | null;
  pinnedFolders: string[];
  showImageCounts: boolean;
  isInstantTransition: boolean;
  folderIcons: Record<string, string>;
}

interface VisibleProps {
  index: number;
  total: number;
}

const ALBUM_ICONS: Record<string, React.ElementType> = {
  plane: Plane,
  mountain: Mountain,
  sun: Sun,
  camera: Camera,
  map: Map,
  heart: Heart,
  star: Star,
  users: Users,
  user: User,
  car: Car,
  briefcase: Briefcase,
};

const filterTree = (node: FolderTree | null, query: string): FolderTree | null => {
  if (!node) {
    return null;
  }

  const lowerCaseQuery = query.toLowerCase();
  const isMatch = node.name.toLowerCase().includes(lowerCaseQuery);

  if (!node.children || node.children.length === 0) {
    return isMatch ? node : null;
  }

  const filteredChildren = node.children
    .map((child: FolderTree) => filterTree(child, query))
    .filter((child: FolderTree | null): child is FolderTree => child !== null);

  if (isMatch || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }

  return null;
};

const getAutoExpandedPaths = (node: FolderTree, paths: Set<string>) => {
  if (node.children && node.children.length > 0) {
    paths.add(node.path);
    node.children.forEach((child: FolderTree) => getAutoExpandedPaths(child, paths));
  }
};

const filterAlbumTree = (node: AlbumItem | null, query: string): AlbumItem | null => {
  if (!node) return null;

  const lowerCaseQuery = query.toLowerCase();
  const isMatch = node.name.toLowerCase().includes(lowerCaseQuery);

  if (node.type === 'album') {
    return isMatch ? node : null;
  }

  if (node.type === 'group') {
    const filteredChildren = node.children
      .map((child: AlbumItem) => filterAlbumTree(child, query))
      .filter((child): child is AlbumItem => child !== null);

    if (isMatch || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
  }

  return null;
};

const getAutoExpandedAlbumGroups = (node: AlbumItem, groups: Set<string>) => {
  if (node.type === 'group' && node.children.length > 0) {
    groups.add(node.id);
    node.children.forEach((child) => getAutoExpandedAlbumGroups(child, groups));
  }
};

const sortFolderTree = (nodes: FolderTree[], sort: FolderTreeSort): FolderTree[] => {
  if (!nodes) return [];
  const sorted = [...nodes].sort((a, b) => {
    let comparison = 0;
    if (sort.key === 'name') comparison = a.name.localeCompare(b.name);
    else if (sort.key === 'modified') comparison = (a.modified || 0) - (b.modified || 0);
    else if (sort.key === 'created') comparison = (a.created || 0) - (b.created || 0);
    else if (sort.key === 'imageCount') comparison = (a.imageCount || 0) - (b.imageCount || 0);
    return sort.order === SortDirection.Ascending ? comparison : -comparison;
  });
  return sorted.map((node) => ({
    ...node,
    children: node.children && node.children.length > 0 ? sortFolderTree(node.children, sort) : node.children,
  }));
};

function FolderSortMenu({
  sort,
  onChange,
  isOpen,
  setIsOpen,
}: {
  sort: FolderTreeSort;
  onChange: (s: FolderTreeSort) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsOpen]);

  const options = [
    { key: 'name', label: t('library.folders.sort.name') },
    { key: 'created', label: t('library.folders.sort.created') },
    { key: 'modified', label: t('library.folders.sort.modified') },
    { key: 'imageCount', label: t('library.folders.sort.imageCount') },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        className={clsx(
          'bg-surface rounded-md hover:bg-card-active flex items-center justify-center shrink-0 overflow-hidden transition-colors w-9 h-9',
          isOpen && 'bg-card-active',
        )}
        onClick={() => setIsOpen(!isOpen)}
        data-tooltip={t('library.folders.tooltips.sortFolders')}
      >
        <ArrowUpDown size={16} className="text-text-secondary" />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 w-48 origin-top-right z-50"
          >
            <div className="bg-surface/90 backdrop-blur-md border border-border-color/50 rounded-lg shadow-xl p-2 flex flex-col">
              <div className="px-3 py-2 relative flex items-center">
                <Text as="div" variant={TextVariants.small} weight={TextWeights.semibold} className="uppercase">
                  {t('library.header.viewOptions.sortBy')}
                </Text>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({
                      ...sort,
                      order:
                        sort.order === SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending,
                    });
                  }}
                  data-tooltip={
                    sort.order === SortDirection.Ascending
                      ? t('library.header.viewOptions.sortDescending')
                      : t('library.header.viewOptions.sortAscending')
                  }
                  className="absolute top-1/2 right-3 -translate-y-1/2 p-1 bg-transparent border-none text-text-secondary hover:text-text-primary rounded-sm transition-colors"
                >
                  {sort.order === SortDirection.Ascending ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {options.map((opt) => {
                const isSelected = sort.key === opt.key;
                return (
                  <button
                    key={opt.key}
                    className={clsx(
                      'w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between transition-colors duration-150',
                      isSelected ? 'bg-card-active' : 'hover:bg-bg-primary',
                    )}
                    onClick={() => {
                      if (sort.key !== opt.key) {
                        onChange({ key: opt.key as any, order: sort.order });
                      }
                      setIsOpen(false);
                    }}
                  >
                    <Text
                      variant={TextVariants.label}
                      color={TextColors.primary}
                      weight={isSelected ? TextWeights.semibold : TextWeights.normal}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && <Check size={16} className={TEXT_COLOR_KEYS[TextColors.primary]} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHeader({ title, isOpen, onToggle }: { title: string; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();

  return (
    <Text
      as="div"
      variant={TextVariants.small}
      weight={TextWeights.bold}
      className="flex items-center w-full px-1.5 py-1 cursor-pointer group text-[10px] text-text-secondary hover:text-text-primary border-b border-border-color/20"
      onClick={onToggle}
      data-tooltip={
        isOpen
          ? t('library.folders.collapseSection', { section: title })
          : t('library.folders.expandSection', { section: title })
      }
    >
      <div className="p-0.5 rounded-md transition-colors text-text-secondary group-hover:text-text-primary">
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>
      <span className="ml-1 uppercase tracking-[0.14em] select-none">{title}</span>
    </Text>
  );
}

const getAlbumImageCount = (item: any): number => {
  if (item.type === 'album' && item.images) {
    return item.images.length;
  }
  if (item.type === 'group' && item.children) {
    return item.children.reduce((sum: number, child: any) => sum + getAlbumImageCount(child), 0);
  }
  return 0;
};

function AlbumTreeNode({
  item,
  expandedGroups,
  onToggle,
  onSelectAlbum,
  onContextMenu,
  selectedAlbumId,
  showImageCounts,
}: {
  item: AlbumItem;
  expandedGroups: Set<string>;
  onToggle: (id: string) => void;
  onSelectAlbum: (id: string, name: string, images: string[]) => void;
  onContextMenu: (e: any, item: AlbumItem) => void;
  selectedAlbumId: string | null;
  showImageCounts: boolean;
}) {
  const isGroup = item.type === 'group';
  const isExpanded = expandedGroups.has(item.id);
  const isSelected = item.id === selectedAlbumId;
  const isTarget = useLibraryStore((s) => s.targetCollectionId === item.id);
  const imageCount = getAlbumImageCount(item);

  let ItemIcon = isGroup ? (isExpanded ? FolderOpen : Folder) : AlbumIcon;
  if (item.icon && ALBUM_ICONS[item.icon]) {
    ItemIcon = ALBUM_ICONS[item.icon];
  }
  const iconKey = item.icon || (isGroup ? (isExpanded ? 'group-open' : 'group-closed') : 'album');

  return (
    <Text as="div" color={TextColors.primary} weight={TextWeights.medium}>
      <div
        className={clsx(
          'flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm transition-colors cursor-pointer border-l-2',
          {
            'bg-card-active border-l-white/70': isSelected,
            'border-l-transparent hover:bg-card-active/60': !isSelected,
          },
        )}
        onClick={() => (isGroup ? onToggle(item.id) : onSelectAlbum(item.id, item.name, (item as Album).images))}
        onContextMenu={(e) => onContextMenu(e, item)}
      >
        <div className="relative w-5 h-5 flex items-center justify-center p-0.5 rounded-sm text-text-secondary shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <ItemIcon size={16} />
            </motion.div>
          </AnimatePresence>
        </div>

        <span onDoubleClick={() => isGroup && onToggle(item.id)} className="truncate flex-1 select-none">
          <span className="truncate">
            {item.type === 'album' ? albumDisplayName(item) : item.name}
            {!isGroup && isTarget && (
              <span className="ml-1 text-[9px] text-amber-300" title="Target Collection">
                ●
              </span>
            )}
          </span>
          {imageCount > 0 && (
            <Text
              as="span"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className={clsx(
                'inline-block ml-1 transition-all ease-in-out duration-300',
                showImageCounts ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2',
              )}
            >
              ({imageCount})
            </Text>
          )}
        </span>

        {isGroup && (
          <div
            className="text-text-secondary p-0.5 rounded-sm hover:bg-surface/50"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item.id);
            }}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isGroup && isExpanded && (item as AlbumGroup).children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="pl-1 border-l-[1.5px] border-border-color/50 ml-3.75 overflow-hidden"
          >
            <div className="py-1">
              <AnimatePresence>
                {(item as AlbumGroup).children.map((child) => (
                  <motion.div
                    key={child.id}
                    initial={{ opacity: 0, height: 0, x: -10 }}
                    animate={{ opacity: 1, height: 'auto', x: 0 }}
                    exit={{ opacity: 0, height: 0, x: -10, overflow: 'hidden' }}
                    transition={{ duration: 0.2 }}
                  >
                    <AlbumTreeNode
                      item={child}
                      expandedGroups={expandedGroups}
                      onToggle={onToggle}
                      onSelectAlbum={onSelectAlbum}
                      onContextMenu={onContextMenu}
                      selectedAlbumId={selectedAlbumId}
                      showImageCounts={showImageCounts}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Text>
  );
}

function ImportedBranches({
  branches,
  collapsed,
  onToggleBranch,
  expandedFolders,
  onContextMenu,
  onFolderSelect,
  onToggle,
  selectedPath,
  pinnedFolders,
  showImageCounts,
  isInstantTransition,
  folderIcons,
}: {
  branches: PathBranch<FolderTree>[];
  collapsed: Set<string>;
  onToggleBranch(path: string): void;
  expandedFolders: Set<string>;
  onContextMenu: FolderTreeProps['onContextMenu'];
  onFolderSelect: FolderTreeProps['onFolderSelect'];
  onToggle: FolderTreeProps['onToggleFolder'];
  selectedPath: string | null;
  pinnedFolders: string[];
  showImageCounts: boolean;
  isInstantTransition: boolean;
  folderIcons: Record<string, string>;
}) {
  return (
    <>
      {branches.map((branch) => {
        if (branch.imported) {
          return (
            <TreeNode
              key={branch.imported.path}
              expandedFolders={expandedFolders}
              isExpanded={expandedFolders.has(branch.imported.path)}
              node={branch.imported}
              onContextMenu={onContextMenu}
              onFolderSelect={onFolderSelect}
              onToggle={onToggle}
              selectedPath={selectedPath}
              pinnedFolders={pinnedFolders}
              showImageCounts={showImageCounts}
              isInstantTransition={isInstantTransition}
              folderIcons={folderIcons}
            />
          );
        }
        const open = !collapsed.has(branch.path);
        return (
          <div key={branch.path}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-1.5 py-1 rounded-sm text-left hover:bg-card-active/60"
              onClick={() => onToggleBranch(branch.path)}
            >
              {open ? (
                <ChevronDown size={14} className="shrink-0 text-text-secondary" />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-text-secondary" />
              )}
              <Folder size={15} className="shrink-0 text-text-secondary" />
              <span className="truncate text-sm">{branch.name}</span>
            </button>
            {open && branch.children.length > 0 && (
              <div className="pl-3">
                <ImportedBranches
                  branches={branch.children}
                  collapsed={collapsed}
                  onToggleBranch={onToggleBranch}
                  expandedFolders={expandedFolders}
                  onContextMenu={onContextMenu}
                  onFolderSelect={onFolderSelect}
                  onToggle={onToggle}
                  selectedPath={selectedPath}
                  pinnedFolders={pinnedFolders}
                  showImageCounts={showImageCounts}
                  isInstantTransition={isInstantTransition}
                  folderIcons={folderIcons}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function TreeNode({
  expandedFolders,
  isExpanded,
  node,
  onContextMenu,
  onFolderSelect,
  onToggle,
  selectedPath,
  pinnedFolders,
  showImageCounts,
  isInstantTransition,
  folderIcons,
}: TreeNodeProps) {
  const hasChildren = node.hasSubdirs || (node.children && node.children.length > 0);
  const isSelected = node.path === selectedPath;
  const isPinned = pinnedFolders.includes(node.path);

  const handleFolderIconClick = (e: any) => {
    e.stopPropagation();
    if (hasChildren) {
      onToggle(node.path);
    }
  };

  const handleNameClick = () => {
    onFolderSelect(node.path);
  };

  const handleNameDoubleClick = () => {
    if (hasChildren) {
      onToggle(node.path);
    }
  };

  const containerVariants: any = {
    closed: { height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeInOut' } },
    open: { height: 'auto', opacity: 1, transition: { duration: 0.25, ease: 'easeInOut' } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -15 },
    visible: ({ index, total }: VisibleProps) => ({
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.25,
        delay: total < 8 ? index * 0.05 : 0,
      },
    }),
    exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
  };

  const currentFolderIconKey = folderIcons[node.path];
  let ResolvedIcon = isExpanded ? FolderOpen : Folder;
  if (currentFolderIconKey && ALBUM_ICONS[currentFolderIconKey]) {
    ResolvedIcon = ALBUM_ICONS[currentFolderIconKey];
  }
  const iconKey = currentFolderIconKey || (isExpanded ? 'folder-open' : 'folder-closed');

  return (
    <Text as="div" color={TextColors.primary} weight={TextWeights.medium}>
      <div
        className={clsx(
          'flex items-center gap-1.5 px-1.5 py-1 rounded-sm transition-colors cursor-pointer border-l-2',
          {
            'bg-card-active border-l-white/70': isSelected,
            'border-l-transparent hover:bg-card-active/60': !isSelected,
          },
        )}
        onClick={handleNameClick}
        onContextMenu={(e: any) => onContextMenu(e, node.path, isPinned)}
      >
        <div
          className={clsx(
            'relative w-5 h-5 flex items-center justify-center p-0.5 rounded-sm transition-colors shrink-0',
            {
              [TEXT_COLOR_KEYS[TextColors.secondary]]: !isExpanded,
              'hover:bg-surface-hover': !isSelected && hasChildren,
            },
          )}
          onClick={handleFolderIconClick}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={iconKey}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <ResolvedIcon size={16} />
            </motion.div>
          </AnimatePresence>
        </div>

        <span onDoubleClick={handleNameDoubleClick} className="truncate select-none flex-1">
          <span className="truncate">{node.name}</span>
          {typeof node.imageCount === 'number' && node.imageCount > 0 && (
            <Text
              as="span"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className={clsx(
                'inline-block ml-1 transition-all ease-in-out duration-300',
                showImageCounts ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2',
              )}
            >
              ({node.imageCount})
            </Text>
          )}
        </span>

        {hasChildren && (
          <Text
            as="div"
            color={TextColors.secondary}
            className="p-0.5 rounded-sm hover:bg-surface/50"
            onClick={handleFolderIconClick}
          >
            {isExpanded ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
          </Text>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && node.children && node.children.length > 0 && (
          <motion.div
            animate="open"
            className="pl-1 border-l-[1.5px] border-border-color/50 ml-3.75 overflow-hidden"
            exit="closed"
            initial={isInstantTransition ? 'open' : 'closed'}
            key="children-container"
            variants={containerVariants}
          >
            <div className="py-1">
              <AnimatePresence>
                {node?.children?.map((childNode: any, index: number) => (
                  <motion.div
                    animate="visible"
                    custom={{ index, total: node.children.length }}
                    exit="exit"
                    initial={isInstantTransition ? 'visible' : 'hidden'}
                    key={childNode.path}
                    layout={isInstantTransition ? false : 'position'}
                    variants={itemVariants}
                  >
                    <TreeNode
                      expandedFolders={expandedFolders}
                      isExpanded={expandedFolders.has(childNode.path)}
                      node={childNode}
                      onContextMenu={onContextMenu}
                      onFolderSelect={onFolderSelect}
                      onToggle={onToggle}
                      selectedPath={selectedPath}
                      pinnedFolders={pinnedFolders}
                      showImageCounts={showImageCounts}
                      isInstantTransition={isInstantTransition}
                      folderIcons={folderIcons}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Text>
  );
}

export default function FolderTree({
  isResizing,
  isVisible,
  onContextMenu,
  onAlbumContextMenu,
  onFolderSelect,
  onSelectAlbum,
  onToggleFolder,
  onOpenFolder,
  setIsVisible,
  style,
  isInstantTransition,
}: FolderTreeProps) {
  const { t } = useTranslation();
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );
  const {
    folderTrees,
    pinnedFolderTrees,
    currentFolderPath: selectedPath,
    expandedFolders,
    isTreeLoading: isLoading,
    albumTree,
    activeAlbumId,
    expandedAlbumGroups,
    filterCriteria,
    setFilterCriteria,
    imageList,
    imageRatings,
    lastImportedPaths,
    showPreviousImportOnly,
    quickCollectionPaths,
    showQuickCollectionOnly,
    showSelectedOnly,
    targetCollectionId,
    multiSelectedPaths,
    libraryActivePath,
  } = useLibraryStore(
    useShallow((state) => ({
      folderTrees: state.folderTrees,
      pinnedFolderTrees: state.pinnedFolderTrees,
      currentFolderPath: state.currentFolderPath,
      expandedFolders: state.expandedFolders,
      isTreeLoading: state.isTreeLoading,
      albumTree: state.albumTree,
      activeAlbumId: state.activeAlbumId,
      expandedAlbumGroups: state.expandedAlbumGroups,
      filterCriteria: state.filterCriteria,
      setFilterCriteria: state.setFilterCriteria,
      imageList: state.imageList,
      imageRatings: state.imageRatings,
      lastImportedPaths: state.lastImportedPaths,
      showPreviousImportOnly: state.showPreviousImportOnly,
      quickCollectionPaths: state.quickCollectionPaths,
      showQuickCollectionOnly: state.showQuickCollectionOnly,
      showSelectedOnly: state.showSelectedOnly,
      targetCollectionId: state.targetCollectionId,
      multiSelectedPaths: state.multiSelectedPaths,
      libraryActivePath: state.libraryActivePath,
    })),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedDrives, setCollapsedDrives] = useState<Set<string>>(new Set());
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const pinnedFolders = appSettings?.pinnedFolders || [];
  const folderHistory = useLibraryStore((s) => s.folderHistory) || [];
  const folderHistoryIndex = useLibraryStore((s) => s.folderHistoryIndex) ?? -1;
  const recentFolders: string[] = Array.isArray(appSettings?.recentFolders)
    ? (appSettings.recentFolders as string[]).filter(Boolean).slice(0, 8)
    : [];


  /** LR-style Keyword List: unique user keywords with hierarchy + counts.
   *  Note: lucide `Map` icon shadows global Map — use globalThis.Map/Set. */
  const keywordList = useMemo(() => {
    type KwEntry = { path: string; count: number; depth: number; label: string };
    const counts = new globalThis.Map<string, number>();
    for (const img of imageList || []) {
      for (const tg of img.tags || []) {
        if (!tg.startsWith('user:')) continue;
        const bare = tg.slice(5).trim().toLowerCase();
        if (!bare) continue;
        counts.set(bare, (counts.get(bare) || 0) + 1);
      }
    }
    // Expand parent paths so travel appears when only travel/paris exists
    const allKeys = Array.from(counts.keys());
    for (const key of allKeys) {
      const parts = key.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (!counts.has(acc)) counts.set(acc, 0);
      }
    }
    const entries: KwEntry[] = Array.from(counts.entries()).map(([path, count]) => ({
      path,
      count,
      depth: path.split('/').length - 1,
      label: path.split('/').pop() || path,
    }));
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }, [imageList]);

  const [keywordListOpen, setKeywordListOpen] = useState(true);
  const [keywordListFilter, setKeywordListFilter] = useState('');
  const visibleKeywords = useMemo(() => {
    const q = keywordListFilter.trim().toLowerCase();
    if (!q) return keywordList.slice(0, 80);
    return keywordList.filter((k) => k.path.includes(q)).slice(0, 80);
  }, [keywordList, keywordListFilter]);

  const openSections = appSettings?.openTreeSections ?? ['current'];
  const showImageCounts = appSettings?.enableFolderImageCounts ?? false;
  const folderIcons = appSettings?.folderIcons || {};
  const folderTreeSort: FolderTreeSort = appSettings?.folderTreeSort || { key: 'name', order: SortDirection.Ascending };

  useEffect(() => {
    invoke(Invokes.GetAlbums).then(async (res: any) => {
      try {
        const tree = await ensureUncategorizedAlbum(res || []);
        useLibraryStore.getState().setLibrary({ albumTree: tree });
      } catch {
        useLibraryStore.getState().setLibrary({ albumTree: res || [] });
      }
    });
  }, []);

  const toggleSection = (section: string) => {
    if (appSettings) {
      const isOpen = openSections.includes(section);
      const newSections = isOpen ? openSections.filter((s) => s !== section) : [...openSections, section];

      handleSettingsChange({ ...appSettings, openTreeSections: newSections });
    }
  };

  const handleEmptyAreaContextMenu = (e: any) => {
    if (e.target === e.currentTarget) {
      onContextMenu(e, null, false);
    }
  };

  const toggleAlbumGroup = (id: string) => {
    useLibraryStore.getState().setLibrary((state) => {
      const next = new Set(state.expandedAlbumGroups);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedAlbumGroups: next };
    });
  };

  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 1;

  const filteredTrees = useMemo(() => {
    let base = folderTrees;
    if (isSearching) {
      base = base.map((tree: any) => filterTree(tree, trimmedQuery)).filter((t: any) => t !== null);
    }
    return sortFolderTree(base, folderTreeSort);
  }, [folderTrees, trimmedQuery, isSearching, folderTreeSort]);

  const driveGroups = useMemo(() => groupTreesByDrive(filteredTrees || []), [filteredTrees]);

  const filteredPinnedTrees = useMemo(() => {
    let base = pinnedFolderTrees;
    if (isSearching) {
      base = base.map((pinnedTree) => filterTree(pinnedTree, trimmedQuery)).filter((t): t is FolderTree => t !== null);
    }
    return sortFolderTree(base, folderTreeSort);
  }, [pinnedFolderTrees, trimmedQuery, isSearching, folderTreeSort]);

  const searchAutoExpandedFolders = useMemo(() => {
    if (!isSearching) return new Set<string>();
    const newExpanded = new Set<string>();
    filteredTrees.forEach((t: any) => getAutoExpandedPaths(t, newExpanded));
    filteredPinnedTrees.forEach((pinned) => getAutoExpandedPaths(pinned, newExpanded));
    return newExpanded;
  }, [isSearching, filteredTrees, filteredPinnedTrees]);

  const effectiveExpandedFolders = useMemo(() => {
    return new Set([...expandedFolders, ...searchAutoExpandedFolders]);
  }, [expandedFolders, searchAutoExpandedFolders]);

  const filteredAlbumTree = useMemo(() => {
    let base = albumTree;
    if (isSearching) {
      base = base.map((item: any) => filterAlbumTree(item, trimmedQuery)).filter((t: any) => t !== null);
    }
    return base;
  }, [albumTree, trimmedQuery, isSearching]);

  const searchAutoExpandedAlbumGroups = useMemo(() => {
    if (!isSearching) return new Set<string>();
    const newExpanded = new Set<string>();
    filteredAlbumTree.forEach((t: any) => getAutoExpandedAlbumGroups(t, newExpanded));
    return newExpanded;
  }, [isSearching, filteredAlbumTree]);

  const effectiveExpandedAlbumGroups = useMemo(() => {
    return new Set([...expandedAlbumGroups, ...searchAutoExpandedAlbumGroups]);
  }, [expandedAlbumGroups, searchAutoExpandedAlbumGroups]);

  useEffect(() => {
    if (isSearching && appSettings) {
      const hasPinnedResults = filteredPinnedTrees && filteredPinnedTrees.length > 0;
      const hasBaseResults = filteredTrees && filteredTrees.length > 0;
      const hasAlbumResults = filteredAlbumTree && filteredAlbumTree.length > 0;

      let newSections = [...openSections];
      let changed = false;

      if (hasPinnedResults && !newSections.includes('pinned')) {
        newSections.push('pinned');
        changed = true;
      }
      if (hasBaseResults && !newSections.includes('current')) {
        newSections.push('current');
        changed = true;
      }
      if (hasAlbumResults && !newSections.includes('albums')) {
        newSections.push('albums');
        changed = true;
      }

      if (changed) {
        handleSettingsChange({ ...appSettings, openTreeSections: newSections });
      }
    }
  }, [
    isSearching,
    filteredTrees,
    filteredPinnedTrees,
    filteredAlbumTree,
    openSections,
    handleSettingsChange,
    appSettings,
  ]);

  const isPinnedOpen = openSections.includes('pinned');
  const isCurrentOpen = openSections.includes('current');
  const isAlbumsOpen = openSections.includes('albums');

  const hasVisiblePinnedTrees = filteredPinnedTrees && filteredPinnedTrees.length > 0;
  const hasVisibleAlbums = filteredAlbumTree && filteredAlbumTree.length > 0;
  const showAlbumsSection = hasVisibleAlbums || (!isSearching && albumTree.length === 0);

  return (
    <div
      className={clsx(
        'relative bg-bg-secondary rounded-lg shrink-0',
        !isResizing && 'transition-[width] duration-300 ease-in-out',
      )}
      style={style}
    >
      {!isVisible && (
        <button
          className="absolute top-1/2 -translate-y-1/2 right-1 w-6 h-10 hover:bg-card-active rounded-md flex items-center justify-center z-30"
          onClick={() => setIsVisible(true)}
          data-tooltip={t('library.folders.tooltips.expand')}
        >
          <ChevronRight size={16} />
        </button>
      )}

      {isVisible && (
        <div className="p-2 flex flex-col h-full">
          <div className="pt-1 pb-2">
            <div className="flex items-center">
              <div className="flex items-center shrink-0 mr-1">
                <button
                  className="bg-surface rounded-md hover:bg-card-active flex items-center justify-center shrink-0 w-9 h-9"
                  onClick={() => setIsVisible(false)}
                  data-tooltip={t('library.folders.tooltips.collapse')}
                >
                  <ChevronLeft size={17.5} className="text-text-secondary" />
                </button>
              </div>

              <div className="relative flex-1 min-w-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder={t('library.folders.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface border border-transparent rounded-md pl-9 pr-8 py-2 text-sm focus:outline-hidden truncate"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-card-active"
                    data-tooltip={t('library.folders.tooltips.clearSearch')}
                  >
                    <X size={16} className="text-text-secondary" />
                  </button>
                )}
              </div>

              <div className="flex items-center shrink-0 ml-1">
                <FolderSortMenu
                  sort={folderTreeSort}
                  onChange={(newSort) => {
                    if (appSettings) handleSettingsChange({ ...appSettings, folderTreeSort: newSort });
                  }}
                  isOpen={isSortMenuOpen}
                  setIsOpen={setIsSortMenuOpen}
                />
              </div>
            </div>
          </div>

          <LayoutGroup id="folder-tree">
          <div className="flex-1 overflow-y-auto flex flex-col" onContextMenu={handleEmptyAreaContextMenu}>
            <div className="px-2 pt-1 flex items-center gap-1">
              <button
                type="button"
                disabled={(folderHistoryIndex ?? -1) <= 0}
                onClick={() => {
                  const lib = useLibraryStore.getState();
                  const hist = lib.folderHistory || [];
                  let idx = lib.folderHistoryIndex ?? -1;
                  if (idx <= 0) return;
                  idx -= 1;
                  lib.setLibrary({ folderHistoryIndex: idx });
                  window.dispatchEvent(
                    new CustomEvent('rustroom:navigate-folder', {
                      detail: { path: hist[idx], fromHistory: true },
                    }),
                  );
                }}
                className="h-6 w-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-30"
                data-tooltip={t('library.folders.folderBack' as any, {
                  defaultValue: 'Back (Alt+←)',
                })}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                disabled={
                  (folderHistoryIndex ?? -1) < 0 ||
                  (folderHistoryIndex ?? -1) >= (folderHistory?.length || 0) - 1
                }
                onClick={() => {
                  const lib = useLibraryStore.getState();
                  const hist = lib.folderHistory || [];
                  let idx = lib.folderHistoryIndex ?? -1;
                  if (idx < 0 || idx >= hist.length - 1) return;
                  idx += 1;
                  lib.setLibrary({ folderHistoryIndex: idx });
                  window.dispatchEvent(
                    new CustomEvent('rustroom:navigate-folder', {
                      detail: { path: hist[idx], fromHistory: true },
                    }),
                  );
                }}
                className="h-6 w-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-30"
                data-tooltip={t('library.folders.folderForward' as any, {
                  defaultValue: 'Forward (Alt+→)',
                })}
              >
                <ChevronRight size={14} />
              </button>
              <span className="text-[9px] uppercase tracking-wider text-text-secondary/50 ml-1">
                {t('library.folders.folderHistory' as any, { defaultValue: 'Folders' })}
              </span>
            </div>
            <div className="px-2 pt-1.5 pb-1 text-[9px] uppercase tracking-[0.18em] text-text-secondary/70 font-semibold select-none">
              {t('library.folders.catalog' as any)}
            </div>
            {/* LR Classic–style Catalog quick filters (All / Previous Import / Picks / Rejects) */}
            <div className="px-1.5 pb-2 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  useLibraryStore.getState().setLibrary({ showPreviousImportOnly: false, showQuickCollectionOnly: false, showSelectedOnly: false });
                  setFilterCriteria((prev) => ({
                    ...prev,
                    flagStatus: FlagStatus.All,
                    editedStatus: EditedStatus.All,
                    hasGps: 'all',
                    hasKeywords: 'all',
                    virtualCopies: 'all',
                    rating: 0,
                    colors: [],
                    dateFrom: undefined,
                    dateTo: undefined,
                  }));
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                  !showPreviousImportOnly && !showQuickCollectionOnly && !showSelectedOnly && (filterCriteria?.flagStatus || FlagStatus.All) === FlagStatus.All && (!filterCriteria?.hasKeywords || filterCriteria?.hasKeywords === 'all') && (filterCriteria?.editedStatus === EditedStatus.All || !filterCriteria?.editedStatus) && (!filterCriteria?.hasGps || filterCriteria?.hasGps === 'all') && (filterCriteria?.rating ?? 0) === 0 && (!(filterCriteria?.colors || []).length)
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                )}
              >
                <Images size={12} className="shrink-0 opacity-80" />
                <span className="truncate flex-1">
                  {t('library.folders.catalogAll' as any, { defaultValue: 'All Photographs' })}
                </span>
                <span className="text-[10px] tabular-nums opacity-50">{imageList.length}</span>
              </button>
              <button
                type="button"
                disabled={!lastImportedPaths?.length}
                onClick={() => {
                  if (!lastImportedPaths?.length) return;
                  useLibraryStore.getState().setLibrary({ showPreviousImportOnly: true, showSelectedOnly: false, showQuickCollectionOnly: false });
                  setFilterCriteria((prev) => ({
                    ...prev,
                    flagStatus: FlagStatus.All,
                    editedStatus: EditedStatus.All,
                    hasGps: 'all',
                    rating: 0,
                  }));
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                  showPreviousImportOnly
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  !lastImportedPaths?.length && 'opacity-40 cursor-not-allowed',
                )}
              >
                <FolderInput size={12} className="shrink-0 opacity-80" />
                <span className="truncate flex-1">
                  {t('library.folders.catalogPreviousImport' as any, { defaultValue: 'Previous Import' })}
                </span>
                <span className="text-[10px] tabular-nums opacity-50">{lastImportedPaths?.length || 0}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  useLibraryStore.getState().setLibrary({
                    showQuickCollectionOnly: !showQuickCollectionOnly,
                    showPreviousImportOnly: false,
                    showSelectedOnly: false,
                    activeAlbumId: null,
                  });
                  setFilterCriteria((prev) => ({
                    ...prev,
                    flagStatus: FlagStatus.All,
                    editedStatus: EditedStatus.All,
                    hasGps: 'all',
                    rating: 0,
                  }));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  useLibraryStore.getState().setLibrary({ targetCollectionId: null });
                }}
                title={
                  !targetCollectionId
                    ? t('library.folders.targetCollection' as any, { defaultValue: 'Target collection (B)' })
                    : t('library.folders.setTargetQc' as any, {
                        defaultValue: 'Right-click: set as Target Collection',
                      })
                }
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                  showQuickCollectionOnly
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                )}
              >
                <Star size={12} className={clsx('shrink-0 opacity-80', showQuickCollectionOnly && 'fill-amber-300 text-amber-300')} />
                <span className="truncate flex-1">
                  {t('library.folders.catalogQuickCollection' as any, { defaultValue: 'Quick Collection' })}
                  {!targetCollectionId && (
                    <span className="ml-1 text-[9px] uppercase tracking-wide text-amber-300/90">●</span>
                  )}
                </span>
                <span className="text-[10px] tabular-nums opacity-50">{quickCollectionPaths?.length || 0}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const lib = useLibraryStore.getState();
                  const hasSel =
                    (lib.multiSelectedPaths && lib.multiSelectedPaths.length > 0) ||
                    !!lib.libraryActivePath;
                  if (!hasSel && !lib.showSelectedOnly) return;
                  lib.setLibrary({
                    showSelectedOnly: !lib.showSelectedOnly,
                    showPreviousImportOnly: false,
                    showQuickCollectionOnly: false,
                    activeAlbumId: null,
                  });
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                  showSelectedOnly
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  !(multiSelectedPaths?.length || libraryActivePath) &&
                    !showSelectedOnly &&
                    'opacity-40',
                )}
              >
                <Check size={12} className="shrink-0 opacity-80" />
                <span className="truncate flex-1">
                  {t('library.folders.catalogSelected' as any, {
                    defaultValue: 'Selected Photographs',
                  })}
                </span>
                <span className="text-[10px] tabular-nums opacity-50">
                  {multiSelectedPaths?.length || (libraryActivePath ? 1 : 0)}
                </span>
              </button>
            </div>
            {/* Folders — above Smart collections */}
            {filteredTrees && filteredTrees.length > 0 && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.folders')}
                    isOpen={isCurrentOpen}
                    onToggle={() => toggleSection('current')}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {isCurrentOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1">
                        <AnimatePresence>
                          {driveGroups.map((group) => {
                            const soleDrive =
                              group.trees.length === 1 && isDriveRootPath(group.trees[0].path);
                            if (soleDrive) {
                              const tree = group.trees[0];
                              return (
                                <TreeNode
                                  key={tree.path}
                                  expandedFolders={effectiveExpandedFolders}
                                  isExpanded={effectiveExpandedFolders.has(tree.path)}
                                  node={tree}
                                  onContextMenu={onContextMenu}
                                  onFolderSelect={onFolderSelect}
                                  onToggle={onToggleFolder}
                                  selectedPath={selectedPath}
                                  pinnedFolders={pinnedFolders}
                                  showImageCounts={showImageCounts}
                                  isInstantTransition={isInstantTransition}
                                  folderIcons={folderIcons}
                                />
                              );
                            }
                            const open = isSearching || !collapsedDrives.has(group.id);
                            return (
                              <div key={group.id}>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-1.5 px-1.5 py-1 rounded-sm text-left hover:bg-card-active/60"
                                  onClick={() =>
                                    setCollapsedDrives((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(group.id)) next.delete(group.id);
                                      else next.add(group.id);
                                      return next;
                                    })
                                  }
                                >
                                  {open ? (
                                    <ChevronDown size={14} className="shrink-0 text-text-secondary" />
                                  ) : (
                                    <ChevronRight size={14} className="shrink-0 text-text-secondary" />
                                  )}
                                  <HardDrive size={15} className="shrink-0 text-text-secondary" />
                                  <span className="truncate text-sm font-medium">
                                    {t('library.folders.drive' as any, {
                                      letter: group.letter,
                                      defaultValue: 'Disque {{letter}}',
                                    })}
                                  </span>
                                </button>
                                {open && (
                                  <div className="pl-3">
                                    <ImportedBranches
                                      branches={mergeImportedBranches(group.trees)}
                                      collapsed={isSearching ? new Set() : collapsedBranches}
                                      onToggleBranch={(path) =>
                                        setCollapsedBranches((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(path)) next.delete(path);
                                          else next.add(path);
                                          return next;
                                        })
                                      }
                                      expandedFolders={effectiveExpandedFolders}
                                      onContextMenu={onContextMenu}
                                      onFolderSelect={onFolderSelect}
                                      onToggle={onToggleFolder}
                                      selectedPath={selectedPath}
                                      pinnedFolders={pinnedFolders}
                                      showImageCounts={showImageCounts}
                                      isInstantTransition={isInstantTransition}
                                      folderIcons={folderIcons}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </AnimatePresence>

                        {!isSearching && (
                          <Text
                            as="div"
                            weight={TextWeights.medium}
                            className="flex items-center gap-2 p-2 mt-1 rounded-md cursor-pointer hover:bg-card-active hover:text-text-primary"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              onOpenFolder();
                            }}
                          >
                            <div className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center">
                              <Plus size={16} />
                            </div>
                            <span className="select-none">{t('library.folders.addFolder')}</span>
                          </Text>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            <div className="order-last mt-auto pt-1 border-t border-border-color/30">
              <button
                type="button"
                className="w-full px-2 py-1.5 text-[9px] uppercase tracking-wider text-text-secondary/70 flex items-center gap-1 hover:text-text-secondary"
                onClick={() => setSmartOpen((v) => !v)}
              >
                {smartOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="flex-1 text-left">
                  {t('library.folders.smartCollections' as any, { defaultValue: 'Smart' })}
                </span>
              </button>
              {smartOpen && (
              <div className="px-1.5 pb-2 space-y-0.5">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.EditedOnly,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'all',
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.editedStatus === EditedStatus.EditedOnly &&
                      (filterCriteria?.hasGps === 'all' || !filterCriteria?.hasGps)
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Pencil size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogEdited' as any, { defaultValue: 'Edited' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => img.is_edited).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.UneditedOnly,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'all',
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.editedStatus === EditedStatus.UneditedOnly &&
                      (filterCriteria?.hasGps === 'all' || !filterCriteria?.hasGps)
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Pencil size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogUnedited' as any, { defaultValue: 'Unedited' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => !img.is_edited).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.RawOnly,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'all',
                      orientation: 'all',
                      hasStack: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.rawStatus === RawStatus.RawOnly
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Camera size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogRaw' as any, { defaultValue: 'RAW Photos' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => img.is_raw).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.NonRawOnly,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'all',
                      orientation: 'all',
                      hasStack: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.rawStatus === RawStatus.NonRawOnly
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Images size={12} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNonRaw' as any, { defaultValue: 'Non-RAW Photos' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => !img.is_raw).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.Unflagged,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.All,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'all',
                      orientation: 'all',
                      hasStack: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.flagStatus === FlagStatus.Unflagged
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Flag size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogUnflagged' as any, { defaultValue: 'Unflagged' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        !(img.tags || []).some(
                          (tag) =>
                            tag === 'flag:pick' ||
                            tag === 'flag:reject' ||
                            tag.endsWith(':pick') ||
                            tag.endsWith(':reject'),
                        ),
                    ).length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: 5,
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      (filterCriteria?.rating ?? 0) === 5 &&
                      (filterCriteria?.editedStatus === EditedStatus.All || !filterCriteria?.editedStatus) &&
                      (filterCriteria?.hasGps === 'all' || !filterCriteria?.hasGps)
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Star size={12} className="shrink-0 opacity-80 fill-current" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogFiveStar' as any, { defaultValue: '5 Stars' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => (imageRatings?.[img.path] || 0) >= 5).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    // rating 1 means "1 and up" in useSortedLibrary
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: prev.rating === 1 ? 0 : 1,
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      (filterCriteria?.rating ?? 0) === 1
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Star size={12} className="shrink-0 opacity-80 fill-current" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogRated' as any, { defaultValue: 'Rated' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => (imageRatings?.[img.path] || img.rating || 0) > 0).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: -1,
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      (filterCriteria?.rating ?? 0) === -1
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Star size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogUnrated' as any, { defaultValue: 'Unrated' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => !(imageRatings?.[img.path] > 0)).length}
                  </span>
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: 0,
                      colors: [],
                      rawStatus: RawStatus.All,
                      orientation: prev.orientation === 'landscape' ? 'all' : 'landscape',
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.orientation === 'landscape'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <span className="text-[10px] font-bold opacity-80 w-3 text-center">L</span>
                  <span className="truncate flex-1">
                    {t('library.folders.catalogLandscape' as any, { defaultValue: 'Landscape' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: 0,
                      colors: [],
                      rawStatus: RawStatus.All,
                      orientation: prev.orientation === 'portrait' ? 'all' : 'portrait',
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.orientation === 'portrait'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <span className="text-[10px] font-bold opacity-80 w-3 text-center">P</span>
                  <span className="truncate flex-1">
                    {t('library.folders.catalogPortrait' as any, { defaultValue: 'Portrait' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.All,
                      hasGps: 'all',
                      rating: 0,
                      colors: [],
                      orientation: prev.orientation === 'square' ? 'all' : 'square',
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.orientation === 'square'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <span className="text-[10px] font-bold opacity-80 w-3 text-center">S</span>
                  <span className="truncate flex-1">
                    {t('library.folders.catalogSquare' as any, { defaultValue: 'Square' })}
                  </span>
                </button>


              <div className="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-text-secondary/50">
                {t('library.folders.colorLabels' as any, { defaultValue: 'Color Labels' })}
              </div>
              <div className="flex items-center gap-1 px-2 pb-1">
                {COLOR_LABELS.map((c) => {
                  const active =
                    !showPreviousImportOnly &&
                    !showQuickCollectionOnly &&
                    Array.isArray(filterCriteria?.colors) &&
                    filterCriteria.colors.length === 1 &&
                    filterCriteria.colors[0] === c.name;
                  const count = imageList.filter((img) =>
                    (img.tags || []).some((tag) => tag === `color:${c.name}`),
                  ).length;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      title={c.name}
                      onClick={() => {
                        useLibraryStore.getState().setLibrary({
                          showPreviousImportOnly: false,
                          showQuickCollectionOnly: false,
                          activeAlbumId: null,
                        });
                        setFilterCriteria((prev) => ({
                          ...prev,
                          flagStatus: FlagStatus.All,
                          editedStatus: EditedStatus.All,
                          hasGps: 'all',
                          rating: 0,
                          colors: active ? [] : [c.name],
                        }));
                      }}
                      className={clsx(
                        'relative w-5 h-5 rounded-full border transition-all',
                        active
                          ? 'ring-2 ring-white/80 scale-110 border-white/50'
                          : 'border-black/40 opacity-80 hover:opacity-100 hover:scale-105',
                      )}
                      style={{ backgroundColor: c.color }}
                    >
                      {count > 0 && (
                        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[8px] tabular-nums text-text-secondary/70">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  title={t('library.folders.catalogNoColor' as any, { defaultValue: 'No color label' })}
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    const active =
                      Array.isArray(filterCriteria?.colors) &&
                      filterCriteria.colors.length === 1 &&
                      filterCriteria.colors[0] === 'none';
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      hasGps: 'all',
                      rating: 0,
                      colors: active ? [] : ['none'],
                    }));
                  }}
                  className={clsx(
                    'w-5 h-5 rounded-full border border-dashed border-white/30 bg-transparent',
                    Array.isArray(filterCriteria?.colors) &&
                      filterCriteria.colors.length === 1 &&
                      filterCriteria.colors[0] === 'none'
                      ? 'ring-2 ring-white/80'
                      : 'opacity-70 hover:opacity-100',
                  )}
                />
              </div>
              <div className="h-2" />
<button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'yes',
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.hasGps === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasGps' as any, { defaultValue: 'Has GPS' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        img.exif?.GPSLatitude != null &&
                        img.exif?.GPSLongitude != null &&
                        String(img.exif.GPSLatitude).trim() !== '' &&
                        String(img.exif.GPSLongitude).trim() !== '',
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      hasGps: 'no',
                      colors: [],
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      filterCriteria?.hasGps === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoGps' as any, { defaultValue: 'No GPS' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasKeywords === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Tags size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasKeywords' as any, { defaultValue: 'Has Keywords' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) =>
                      (img.tags || []).some((tg) => tg.startsWith('user:')),
                    ).length}
                  </span>
                </button>
                      <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasStack: prev.hasStack === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      keyword: undefined,
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasStack === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Layers size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogStacked' as any, { defaultValue: 'Stacked' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => (img.tags || []).some((tg) => String(tg).startsWith('stack:'))).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!appSettings) return;
                    await handleSettingsChange({
                      ...appSettings,
                      hideRejectedPhotos: !appSettings.hideRejectedPhotos,
                    });
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    appSettings?.hideRejectedPhotos
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                  data-tooltip={t('library.folders.hideRejectedTip' as any, {
                    defaultValue: 'Hide rejected photos from Library (Ctrl+Alt+R)',
                  })}
                >
                  <FlagOff size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.hideRejected' as any, {
                      defaultValue: 'Hide Rejected',
                    })}
                  </span>
                  {appSettings?.hideRejectedPhotos && (
                    <span className="text-[9px] uppercase tracking-wide text-accent">On</span>
                  )}
                </button>

          <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'no',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasKeywords === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Tags size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogUntagged' as any, { defaultValue: 'No Keywords' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !(img.tags || []).some((tg) => tg.startsWith('user:')),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCaption === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCaption' as any, { defaultValue: 'Has Caption' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const e = img.exif || {};
                      const hay = [
                        e.ImageDescription,
                        e.XPComment,
                        e.XPTitle,
                        e.Description,
                        e.Caption,
                        e['Caption-Abstract'],
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .trim();
                      return hay.length > 0;
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'no',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCaption === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoCaption' as any, { defaultValue: 'No Caption' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const e = img.exif || {};
                      const hay = [
                        e.ImageDescription,
                        e.XPComment,
                        e.XPTitle,
                        e.Description,
                        e.Caption,
                        e['Caption-Abstract'],
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .trim();
                      return hay.length === 0;
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: prev.hasPeople === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasPeople === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Users size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasPeople' as any, { defaultValue: 'Has People' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        !!(img.exif?.PersonInImage || img.exif?.['Person In Image']),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: prev.hasPeople === 'no' ? 'all' : 'no',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasPeople === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Users size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoPeople' as any, { defaultValue: 'No People' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        !(img.exif?.PersonInImage || img.exif?.['Person In Image']),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: prev.hasEvent === 'yes' ? 'all' : 'yes',
                      hasScene: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasEvent === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasEvent' as any, { defaultValue: 'Has Event' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Event && String(img.exif.Event).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: prev.hasEvent === 'no' ? 'all' : 'no',
                      hasScene: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasEvent === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoEvent' as any, { defaultValue: 'No Event' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !(img.exif?.Event && String(img.exif.Event).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: prev.hasScene === 'yes' ? 'all' : 'yes',
                      hasGenre: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasScene === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Mountain size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasScene' as any, { defaultValue: 'Has Scene' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Scene && String(img.exif.Scene).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: prev.hasScene === 'no' ? 'all' : 'no',
                      hasGenre: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasScene === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Mountain size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoScene' as any, { defaultValue: 'No Scene' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !(img.exif?.Scene && String(img.exif.Scene).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: prev.hasGenre === 'yes' ? 'all' : 'yes',
                      hasSubjectCode: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasGenre === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Tags size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasGenre' as any, { defaultValue: 'Has Genre' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const g =
                        img.exif?.IntellectualGenre ||
                        img.exif?.['Intellectual Genre'] ||
                        '';
                      return !!(g && String(g).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: prev.hasGenre === 'no' ? 'all' : 'no',
                      hasSubjectCode: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasGenre === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Tags size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoGenre' as any, { defaultValue: 'No Genre' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const g =
                        img.exif?.IntellectualGenre ||
                        img.exif?.['Intellectual Genre'] ||
                        '';
                      return !(g && String(g).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: prev.hasSubjectCode === 'yes' ? 'all' : 'yes',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasSubjectCode === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasSubjectCode' as any, {
                      defaultValue: 'Has Subject Code',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const sc =
                        img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
                      return !!(sc && String(sc).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: prev.hasSubjectCode === 'no' ? 'all' : 'no',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasSubjectCode === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoSubjectCode' as any, {
                      defaultValue: 'No Subject Code',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const sc =
                        img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
                      return !(sc && String(sc).trim());
                    }).length}
                  </span>
            
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: prev.hasCategory === 'yes' ? 'all' : 'yes',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCategory === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Briefcase size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCategory' as any, {
                      defaultValue: 'Has Category',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Category && String(img.exif.Category).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: prev.hasCategory === 'no' ? 'all' : 'no',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCategory === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Briefcase size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoCategory' as any, {
                      defaultValue: 'No Category',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !(img.exif?.Category && String(img.exif.Category).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: prev.hasJobId === 'yes' ? 'all' : 'yes',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasJobId === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Briefcase size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasJob' as any, { defaultValue: 'Has Job ID' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const j =
                        img.exif?.JobIdentifier ||
                        img.exif?.JobID ||
                        img.exif?.['Job Identifier'] ||
                        '';
                      return !!(j && String(j).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: prev.hasJobId === 'no' ? 'all' : 'no',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasJobId === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Briefcase size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoJob' as any, { defaultValue: 'No Job ID' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const j =
                        img.exif?.JobIdentifier ||
                        img.exif?.JobID ||
                        img.exif?.['Job Identifier'] ||
                        '';
                      return !(j && String(j).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: prev.hasUrgency === 'yes' && !prev.urgencyMax ? 'all' : 'yes',
                      urgencyMax: undefined,
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasUrgency === 'yes' &&
                      !filterCriteria?.urgencyMax
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Flag size={12} className="shrink-0 opacity-80 text-red-400" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasUrgency' as any, {
                      defaultValue: 'Has Urgency',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const n = parseInt(String(img.exif?.Urgency || ''), 10);
                      return Number.isFinite(n) && n >= 1 && n <= 8;
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => {
                      const active =
                        prev.hasUrgency === 'yes' && prev.urgencyMax === 2;
                      return {
                        ...prev,
                        flagStatus: FlagStatus.All,
                        editedStatus: EditedStatus.All,
                        rating: 0,
                        hasGps: 'all',
                        hasKeywords: 'all',
                        hasCaption: 'all',
                        hasLocation: 'all',
                        hasPeople: 'all',
                        hasEvent: 'all',
                        hasScene: 'all',
                        hasGenre: 'all',
                        hasSubjectCode: 'all',
                        hasCategory: 'all',
                        hasJobId: 'all',
                        hasUrgency: active ? 'all' : 'yes',
                        urgencyMax: active ? undefined : 2,
                        hasCaptionWriter: 'all',
                        hasDigitalSource: 'all',
                        virtualCopies: 'all',
                        colors: [],
                        dateFrom: undefined,
                        dateTo: undefined,
                      };
                    });
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasUrgency === 'yes' &&
                      filterCriteria?.urgencyMax === 2
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Flag size={12} className="shrink-0 opacity-80 text-red-500" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHighUrgency' as any, {
                      defaultValue: 'High Urgency (1–2)',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const n = parseInt(String(img.exif?.Urgency || ''), 10);
                      return Number.isFinite(n) && n >= 1 && n <= 2;
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: prev.hasUrgency === 'no' ? 'all' : 'no',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasUrgency === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Flag size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoUrgency' as any, {
                      defaultValue: 'No Urgency',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const n = parseInt(String(img.exif?.Urgency || ''), 10);
                      return !(Number.isFinite(n) && n >= 1 && n <= 8);
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: prev.hasCaptionWriter === 'yes' ? 'all' : 'yes',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCaptionWriter === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Pencil size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCaptionWriter' as any, {
                      defaultValue: 'Has Caption Writer',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const w =
                        img.exif?.CaptionWriter ||
                        img.exif?.['Caption Writer'] ||
                        img.exif?.Writer ||
                        '';
                      return !!(w && String(w).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: prev.hasDigitalSource === 'yes' ? 'all' : 'yes',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasDigitalSource === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Camera size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasDigitalSource' as any, {
                      defaultValue: 'Has Digital Source',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const d =
                        img.exif?.DigitalSourceType ||
                        img.exif?.['Digital Source Type'] ||
                        '';
                      return !!(d && String(d).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: prev.hasHeadline === 'yes' ? 'all' : 'yes',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasHeadline === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasHeadline' as any, {
                      defaultValue: 'Has Headline',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Headline && String(img.exif.Headline).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: prev.hasTitle === 'yes' ? 'all' : 'yes',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasTitle === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasTitle' as any, {
                      defaultValue: 'Has Title',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const title = img.exif?.XPTitle || img.exif?.Title || '';
                      return !!(title && String(title).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: prev.hasCredit === 'yes' ? 'all' : 'yes',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCredit === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCredit' as any, {
                      defaultValue: 'Has Credit',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Credit && String(img.exif.Credit).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: prev.hasSource === 'yes' ? 'all' : 'yes',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasSource === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasSource' as any, {
                      defaultValue: 'Has Source',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Source && String(img.exif.Source).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: prev.hasInstructions === 'yes' ? 'all' : 'yes',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasInstructions === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasInstructions' as any, {
                      defaultValue: 'Has Instructions',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        !!(img.exif?.Instructions && String(img.exif.Instructions).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: prev.hasCreator === 'yes' ? 'all' : 'yes',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCreator === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCreator' as any, {
                      defaultValue: 'Has Creator',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const c = img.exif?.Artist || img.exif?.Creator || '';
                      return !!(c && String(c).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: prev.hasRights === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasRights === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasRights' as any, {
                      defaultValue: 'Has Rights / Copyright',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const r =
                        img.exif?.Copyright ||
                        img.exif?.Rights ||
                        img.exif?.UsageTerms ||
                        img.exif?.['Usage Terms'] ||
                        '';
                      return !!(r && String(r).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: prev.hasJobTitle === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasJobTitle === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasJobTitle' as any, {
                      defaultValue: 'Has Job Title',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const j =
                        img.exif?.AuthorsPosition || img.exif?.['Authors Position'] || '';
                      return !!(j && String(j).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: prev.hasCity === 'yes' ? 'all' : 'yes',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCity === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCity' as any, {
                      defaultValue: 'Has City',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.City && String(img.exif.City).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: prev.hasCountry === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCountry === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCountry' as any, {
                      defaultValue: 'Has Country',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => !!(img.exif?.Country && String(img.exif.Country).trim()),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: prev.hasState === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasState === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasState' as any, {
                      defaultValue: 'Has State / Province',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const s = img.exif?.State || img.exif?.Province || '';
                      return !!(s && String(s).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: prev.hasSubLocation === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasSubLocation === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasSubLocation' as any, {
                      defaultValue: 'Has Sub-location',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const s = img.exif?.Location || img.exif?.SubLocation || '';
                      return !!(s && String(s).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: prev.hasCountryCode === 'yes' ? 'all' : 'yes',
                      hasUsageTerms: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasCountryCode === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasCountryCode' as any, {
                      defaultValue: 'Has Country Code',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const c =
                        img.exif?.CountryCode || img.exif?.['Country Code'] || '';
                      return !!(c && String(c).trim());
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      hasPeople: 'all',
                      hasEvent: 'all',
                      hasScene: 'all',
                      hasGenre: 'all',
                      hasSubjectCode: 'all',
                      hasCategory: 'all',
                      hasJobId: 'all',
                      hasUrgency: 'all',
                      urgencyMax: undefined,
                      hasCaptionWriter: 'all',
                      hasDigitalSource: 'all',
                      hasHeadline: 'all',
                      hasTitle: 'all',
                      hasCredit: 'all',
                      hasSource: 'all',
                      hasInstructions: 'all',
                      hasCreator: 'all',
                      hasRights: 'all',
                      hasJobTitle: 'all',
                      hasCity: 'all',
                      hasCountry: 'all',
                      hasState: 'all',
                      hasSubLocation: 'all',
                      hasCountryCode: 'all',
                      hasUsageTerms: prev.hasUsageTerms === 'yes' ? 'all' : 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasUsageTerms === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasUsageTerms' as any, {
                      defaultValue: 'Has Usage Terms',
                    })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const u =
                        img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
                      return !!(u && String(u).trim());
                    }).length}
                  </span>
                </button>







                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'yes',
                      virtualCopies: 'all',
                      colors: [],
                      city: undefined,
                      country: undefined,
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasLocation === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogHasLocation' as any, { defaultValue: 'Has Location' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const e = img.exif || {};
                      return !!(
                        (e.City && String(e.City).trim()) ||
                        (e.Country && String(e.Country).trim()) ||
                        (e.Location && String(e.Location).trim()) ||
                        (e.SubLocation && String(e.SubLocation).trim()) ||
                        (e.State && String(e.State).trim()) ||
                        (e.Province && String(e.Province).trim())
                      );
                    }).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'no',
                      virtualCopies: 'all',
                      colors: [],
                      city: undefined,
                      country: undefined,
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.hasLocation === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <MapPin size={12} className="shrink-0 opacity-40" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogNoLocation' as any, { defaultValue: 'No Location' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter((img) => {
                      const e = img.exif || {};
                      return !(
                        (e.City && String(e.City).trim()) ||
                        (e.Country && String(e.Country).trim()) ||
                        (e.Location && String(e.Location).trim()) ||
                        (e.SubLocation && String(e.SubLocation).trim()) ||
                        (e.State && String(e.State).trim()) ||
                        (e.Province && String(e.Province).trim())
                      );
                    }).length}
                  </span>
                </button>


                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      orientation: 'all',
                      hasStack: 'all',
                      virtualCopies: 'yes',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.virtualCopies === 'yes'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Copy size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogVirtualCopies' as any, { defaultValue: 'Virtual Copies' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) => img.is_virtual_copy || String(img.path || '').includes('?vc='),
                    ).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rawStatus: RawStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      orientation: 'all',
                      hasStack: 'all',
                      virtualCopies: 'no',
                      colors: [],
                      dateFrom: undefined,
                      dateTo: undefined,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.virtualCopies === 'no'
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Images size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogMasters' as any, { defaultValue: 'Masters' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50">
                    {imageList.filter(
                      (img) =>
                        !img.is_virtual_copy && !String(img.path || '').includes('?vc='),
                    ).length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, '0');
                    const d = String(now.getDate()).padStart(2, '0');
                    const today = `${y}-${m}-${d}`;
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'capture',
                      dateFrom: today,
                      dateTo: today,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      !!filterCriteria?.dateFrom &&
                      filterCriteria?.dateFrom === filterCriteria?.dateTo &&
                      filterCriteria?.dateField !== 'modified' &&
                      filterCriteria?.dateFrom ===
                        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-80" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogToday' as any, { defaultValue: 'Today' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const start = new Date(end);
                    start.setDate(start.getDate() - 6);
                    const fmt = (dt: Date) =>
                      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'capture',
                      dateFrom: fmt(start),
                      dateTo: fmt(end),
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.dateField !== 'modified' &&
                      !!filterCriteria?.dateFrom &&
                      !!filterCriteria?.dateTo &&
                      filterCriteria.dateFrom !== filterCriteria.dateTo
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-60" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogThisWeek' as any, { defaultValue: 'Past 7 Days' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date();
                    const day = start.getDay();
                    const diff = day === 0 ? 6 : day - 1; // Monday start
                    start.setDate(start.getDate() - diff);
                    const fmt = (dt: Date) =>
                      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'capture',
                      dateFrom: fmt(start),
                      dateTo: fmt(end),
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.dateField === 'capture' &&
                      !!filterCriteria?.dateFrom &&
                      !!filterCriteria?.dateTo &&
                      filterCriteria.dateFrom !== filterCriteria.dateTo
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-60" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogCalendarWeek' as any, { defaultValue: 'This Week' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, '0');
                    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
                    const from = `${y}-${m}-01`;
                    const to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'capture',
                      dateFrom: from,
                      dateTo: to,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      !!filterCriteria?.dateFrom &&
                      filterCriteria.dateFrom?.endsWith('-01') &&
                      filterCriteria.dateFrom?.slice(0, 7) ===
                        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` &&
                      filterCriteria.dateFrom !== filterCriteria.dateTo
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogThisMonth' as any, { defaultValue: 'This Month' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const y = new Date().getFullYear();
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'capture',
                      dateFrom: `${y}-01-01`,
                      dateTo: `${y}-12-31`,
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.dateFrom === `${new Date().getFullYear()}-01-01` &&
                      filterCriteria?.dateTo === `${new Date().getFullYear()}-12-31`
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Calendar size={12} className="shrink-0 opacity-50" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogThisYear' as any, { defaultValue: 'This Year' })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date();
                    start.setDate(start.getDate() - 6);
                    const fmt = (dt: Date) =>
                      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                    useLibraryStore.getState().setLibrary({
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                      activeAlbumId: null,
                    });
                    setFilterCriteria((prev) => ({
                      ...prev,
                      flagStatus: FlagStatus.All,
                      editedStatus: EditedStatus.All,
                      rating: 0,
                      hasGps: 'all',
                      hasKeywords: 'all',
                      hasCaption: 'all',
                      hasLocation: 'all',
                      virtualCopies: 'all',
                      colors: [],
                      dateField: 'modified',
                      dateFrom: fmt(start),
                      dateTo: fmt(end),
                    }));
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                    !showPreviousImportOnly &&
                      !showQuickCollectionOnly &&
                      !showSelectedOnly &&
                      filterCriteria?.dateField === 'modified' &&
                      !!filterCriteria?.dateFrom &&
                      !!filterCriteria?.dateTo
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                  )}
                >
                  <Pencil size={12} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">
                    {t('library.folders.catalogRecentlyModified' as any, {
                      defaultValue: 'Recently Modified',
                    })}
                  </span>
                </button>

              </div>

            {/* LR Keyword List — hierarchical keywords from current library */}
            {keywordList.length > 0 && (
              <div className="mt-2 pt-1 border-t border-border-color/20">
                <button
                  type="button"
                  className="w-full px-2 py-1 text-[9px] uppercase tracking-wider text-text-secondary/50 flex items-center gap-1 hover:text-text-secondary"
                  onClick={() => setKeywordListOpen((v) => !v)}
                >
                  <Tags size={10} className="shrink-0 opacity-70" />
                  <span className="flex-1 text-left">
                    {t('library.folders.keywordList' as any, { defaultValue: 'Keyword List' })}
                  </span>
                  <span className="text-[10px] tabular-nums opacity-50 normal-case tracking-normal">
                    {keywordList.length}
                  </span>
                  {keywordListOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                {keywordListOpen && (
                  <div className="px-1.5 pb-1 space-y-0.5">
                    {keywordList.length > 8 && (
                      <input
                        type="text"
                        value={keywordListFilter}
                        onChange={(e) => setKeywordListFilter(e.target.value)}
                        placeholder={t('library.folders.filterKeywords' as any, {
                          defaultValue: 'Filter keywords…',
                        })}
                        className="w-full h-6 mb-1 px-1.5 rounded bg-surface border border-border-color/30 text-[10px] text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-white/25"
                      />
                    )}
                    {visibleKeywords.map((kw) => {
                      const active =
                        String(filterCriteria?.keyword || '')
                          .trim()
                          .toLowerCase() === kw.path;
                      return (
                        <button
                          key={kw.path}
                          type="button"
                          onClick={() => {
                            useLibraryStore.getState().setLibrary({
                              showPreviousImportOnly: false,
                              showQuickCollectionOnly: false,
                              showSelectedOnly: false,
                              activeAlbumId: null,
                            });
                            setFilterCriteria((prev) => ({
                              ...prev,
                              flagStatus: FlagStatus.All,
                              editedStatus: EditedStatus.All,
                              hasGps: 'all',
                              hasKeywords: 'all',
                              hasCaption: 'all',
                              hasLocation: 'all',
                              virtualCopies: 'all',
                              rating: 0,
                              colors: [],
                              dateFrom: undefined,
                              dateTo: undefined,
                              keyword: active ? undefined : kw.path,
                            }));
                            // Select matching photos
                            if (!active) {
                              const paths = (imageList || [])
                                .filter((img) =>
                                  (img.tags || []).some((tg: string) => {
                                    const bare = tg
                                      .toLowerCase()
                                      .replace(/^user:/, '')
                                      .replace(/^color:/, '')
                                      .replace(/^flag:/, '');
                                    return bare === kw.path || bare.startsWith(kw.path + '/');
                                  }),
                                )
                                .map((img) => img.path);
                              if (paths.length) {
                                useLibraryStore.getState().setLibrary({
                                  multiSelectedPaths: paths,
                                  libraryActivePath: paths[paths.length - 1],
                                  selectionAnchorPath: paths[0],
                                });
                              }
                            } else {
                              useLibraryStore.getState().setLibrary({
                                multiSelectedPaths: [],
                              });
                            }
                          }}
                          className={clsx(
                            'w-full flex items-center gap-1 py-0.5 rounded text-left text-[11px]',
                            active
                              ? 'bg-card-active text-text-primary'
                              : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                          )}
                          style={{ paddingLeft: 8 + kw.depth * 10 }}
                          data-tooltip={
                            t('library.folders.keywordListTip' as any, {
                              defaultValue: 'Click: filter · Double-click: paint mode',
                            }) +
                            ' — ' +
                            kw.path.replace(/\//g, ' › ')
                          }
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const st = useLibraryStore.getState();
                            const cur =
                              st.libraryPainter?.kind === 'keyword'
                                ? String(st.libraryPainter.value || '')
                                : st.keywordPaintTag;
                            const next = cur === kw.path ? null : kw.path;
                            st.setLibrary({
                              libraryPainter: next ? { kind: 'keyword', value: next } : null,
                              keywordPaintTag: next,
                            });
                          }}
                        >
                          <span className="truncate flex-1">
                            {kw.depth > 0 ? '› ' : ''}
                            {kw.label}
                          </span>
                          {kw.count > 0 && (
                            <span className="text-[10px] tabular-nums opacity-50 pr-1">{kw.count}</span>
                          )}
                        </button>
                      );
                    })}
                    {visibleKeywords.length === 0 && (
                      <div className="px-2 py-1 text-[10px] text-text-secondary/40">
                        {t('library.folders.noMatchingKeywords' as any, {
                          defaultValue: 'No matching keywords',
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
              </div>
              )}
            </div>

            {recentFolders.length > 0 && (
              <div className="mt-2 pt-1 border-t border-border-color/20">
                <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-text-secondary/50 flex items-center gap-1">
                  <span className="flex-1">
                    {t('library.folders.catalogRecentFolders' as any, { defaultValue: 'Recent Folders' })}
                  </span>
                  <button
                    type="button"
                    className="normal-case tracking-normal text-[9px] text-text-secondary/50 hover:text-text-primary px-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!appSettings) return;
                      handleSettingsChange({ ...appSettings, recentFolders: [] } as any);
                    }}
                    data-tooltip={t('library.folders.clearRecent' as any, {
                      defaultValue: 'Clear recent folders',
                    })}
                  >
                    {t('library.folders.clear' as any, { defaultValue: 'Clear' })}
                  </button>
                </div>
                <div className="space-y-0.5">
                  {recentFolders.map((folderPath) => {
                    const parts = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
                    const name = parts[parts.length - 1] || folderPath;
                    const active = selectedPath === folderPath;
                    return (
                      <button
                        key={folderPath}
                        type="button"
                        onClick={() => onFolderSelect(folderPath)}
                        className={clsx(
                          'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px]',
                          active
                            ? 'bg-card-active text-text-primary'
                            : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
                        )}
                        title={folderPath}
                      >
                        <Folder size={12} className="shrink-0 opacity-60" />
                        <span className="truncate flex-1">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
{hasVisiblePinnedTrees && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.pinned')}
                    isOpen={isPinnedOpen}
                    onToggle={() => toggleSection('pinned')}
                  />
                </div>
                <AnimatePresence initial={false}>
                  {isPinnedOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1 pb-2">
                        <AnimatePresence>
                          {filteredPinnedTrees.map((pinnedTree, index) => (
                            <motion.div
                              key={pinnedTree.path}
                              animate="visible"
                              custom={{ index, total: filteredPinnedTrees.length }}
                              exit="exit"
                              initial={isInstantTransition ? 'visible' : 'hidden'}
                              layout={isInstantTransition ? false : 'position'}
                              variants={{
                                hidden: { opacity: 0, x: -15 },
                                visible: ({ index, total }: VisibleProps) => ({
                                  opacity: 1,
                                  x: 0,
                                  transition: { duration: 0.25, delay: total < 8 ? index * 0.05 : 0 },
                                }),
                                exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
                              }}
                            >
                              <TreeNode
                                expandedFolders={effectiveExpandedFolders}
                                isExpanded={effectiveExpandedFolders.has(pinnedTree.path)}
                                node={pinnedTree}
                                onContextMenu={onContextMenu}
                                onFolderSelect={onFolderSelect}
                                onToggle={onToggleFolder}
                                selectedPath={selectedPath}
                                pinnedFolders={pinnedFolders}
                                showImageCounts={showImageCounts}
                                isInstantTransition={isInstantTransition}
                                folderIcons={folderIcons}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {showAlbumsSection && (
              <>
                <div>
                  <SectionHeader
                    title={t('library.folders.sections.albums')}
                    isOpen={isAlbumsOpen}
                    onToggle={() => toggleSection('albums')}
                  />
                </div>
                <AnimatePresence>
                  {isAlbumsOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onAlbumContextMenu(e, null);
                      }}
                    >
                      <div className="pt-1 pb-2">
                        <AnimatePresence>
                          {filteredAlbumTree.map((item: any) => (
                            <motion.div
                              key={item.id}
                              initial={{ opacity: 0, height: 0, x: -15 }}
                              animate={{ opacity: 1, height: 'auto', x: 0 }}
                              exit={{ opacity: 0, height: 0, x: -15, overflow: 'hidden' }}
                              transition={{ duration: 0.2 }}
                              layout="position"
                            >
                              <AlbumTreeNode
                                item={item}
                                expandedGroups={effectiveExpandedAlbumGroups}
                                onToggle={toggleAlbumGroup}
                                onSelectAlbum={onSelectAlbum}
                                onContextMenu={onAlbumContextMenu}
                                selectedAlbumId={activeAlbumId}
                                showImageCounts={showImageCounts}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        {albumTree.length === 0 && !isSearching && (
                          <motion.div layout="position">
                            <Text variant={TextVariants.small} className="p-2 text-center">
                              {t('library.folders.albumsEmpty')}
                            </Text>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {!filteredTrees?.length && !hasVisiblePinnedTrees && !hasVisibleAlbums && isSearching && (
              <Text className="p-2 text-center">{t('library.folders.noFoldersFound')}</Text>
            )}

            {folderTrees.length === 0 && pinnedFolderTrees.length === 0 && !isSearching && (
              <div className="pt-1">
                {isLoading ? (
                  <Text className="animate-pulse p-2">{t('library.folders.loading')}</Text>
                ) : (
                  <Text className="p-2">{t('library.folders.openFolderInstruction')}</Text>
                )}
              </div>
            )}
          </div>
          </LayoutGroup>
        </div>
      )}
    </div>
  );
}
