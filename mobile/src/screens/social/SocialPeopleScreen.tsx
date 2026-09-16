import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useAuth, useAlert } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { PeopleMode } from '../../services/api/social';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';

export default function SocialPeopleScreen({
  navigation,
  route,
  community = false,
}: {
  navigation: any;
  route: any;
  community?: boolean;
}) {
  const api = useSocialApi();
  const s = useStyles(stylesFor),
    { user } = useAuth(),
    { confirm } = useAlert();
  const [mode, setMode] = useState<PeopleMode>(route.params?.mode || 'search');
  const [input, setInput] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const resource = useSocialResource(
    useCallback(
      () =>
        mode === 'search' && !query
          ? Promise.resolve([])
          : api.people(user!.id, mode, query, page),
      [api, user, mode, query, page],
    ),
  );
  return (
    <Page>
      <Text style={s.title}>{community ? '关系管理' : '找到一起复盘的人'}</Text>
      <Text style={s.muted}>关注只建立关系，不会自动分享任何账单。</Text>
      <View style={s.row}>
        <View style={s.grow}>
          <Action
            title="评账授权"
            onPress={() => navigation.navigate('SocialGrants')}
          />
        </View>
        <View style={s.grow}>
          <Action
            title="评账申请"
            onPress={() => navigation.navigate('SocialRequests')}
          />
        </View>
      </View>
      <View style={s.chipRow}>
        {(
          [
            ['search', '查找'],
            ['following', '我的关注'],
            ['followers', '关注我的'],
            ['friends', '好友'],
            ['blocks', '已拉黑'],
          ] as const
        ).map(([key, label]) => (
          <Action
            key={key}
            title={label}
            primary={mode === key}
            onPress={() => {
              setMode(key);
              setPage(1);
            }}
          />
        ))}
      </View>
      {mode === 'search' && (
        <>
          <Text style={s.text}>昵称或完整用户 ID</Text>
          <TextInput
            accessibilityLabel="昵称或完整用户 ID"
            value={input}
            onChangeText={setInput}
            style={s.input}
            autoCapitalize="none"
            maxLength={100}
            returnKeyType="search"
            onSubmitEditing={() => {
              setQuery(input.trim());
              setPage(1);
            }}
          />
          <Action
            title="查找"
            disabled={!input.trim()}
            onPress={() => {
              setQuery(input.trim());
              setPage(1);
            }}
          />
        </>
      )}
      <Status {...resource} />
      {resource.value?.map(person => (
        <View style={s.card} key={person.id}>
          <Text style={s.heading}>{person.nickname || '未设置昵称'}</Text>
          <Text selectable style={s.small}>
            {person.id}
          </Text>
          {mode === 'blocks' ? (
            <Action
              title="解除拉黑"
              disabled={resource.busy}
              onPress={() =>
                confirm(
                  '解除拉黑',
                  '解除后双方可以重新建立关系；之前的授权不会自动恢复。',
                  () => {
                    void resource.run(() => api.block(person.id, false));
                  },
                )
              }
            />
          ) : (
            <Action
              title={person.id === user?.id ? '这是你的账号' : '查看关系与授权'}
              disabled={person.id === user?.id}
              onPress={() =>
                navigation.navigate('SocialPerson', { userId: person.id })
              }
            />
          )}
        </View>
      ))}
      {resource.value?.length === 0 && (
        <Text style={s.muted}>
          {mode === 'search' && !query
            ? '输入昵称或完整 ID 开始查找。'
            : '没有符合条件的用户。'}
        </Text>
      )}
      {resource.value && (
        <View style={s.row}>
          <View style={s.grow}>
            <Action
              title="上一页"
              disabled={page === 1}
              onPress={() => setPage(p => p - 1)}
            />
          </View>
          <Text style={s.muted}>{page}</Text>
          <View style={s.grow}>
            <Action
              title="下一页"
              disabled={resource.value.length < 20}
              onPress={() => setPage(p => p + 1)}
            />
          </View>
        </View>
      )}
    </Page>
  );
}
